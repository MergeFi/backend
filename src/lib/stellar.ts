'use client';

import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  type ISupportedWallet,
} from '@creit.tech/stellar-wallets-kit';
import storage from './storage';
import { WALLET_STORAGE_KEY, ADDRESS_STORAGE_KEY, NETWORK_STORAGE_KEY, STELLAR_NETWORK } from './constants';
import { WalletError } from './errors';

export type WalletAddress = string;

const NETWORK: WalletNetwork =
  STELLAR_NETWORK === 'PUBLIC' ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;

let _kit: StellarWalletsKit | null = null;

function getKit(): StellarWalletsKit {
  if (!_kit) {
    _kit = new StellarWalletsKit({
      network: NETWORK,
      selectedWalletId: storage.get(WALLET_STORAGE_KEY) ?? undefined,
      modules: allowAllModules(),
    });
  }
  return _kit;
}

export async function connectWallet(): Promise<WalletAddress> {
  const kit = getKit();
  return new Promise<WalletAddress>((resolve, reject) => {
    kit.openModal({
      modalTitle: 'Connect your wallet',
      onWalletSelected: async (option: ISupportedWallet) => {
        try {
          kit.setWallet(option.id);
          const { address } = await kit.getAddress();
          if (!address) throw new WalletError('No address returned from wallet');
          storage.set(WALLET_STORAGE_KEY, option.id);
          storage.set(ADDRESS_STORAGE_KEY, address);
          try {
            const { network, networkPassphrase } = await kit.getNetwork();
            if (network) storage.set(NETWORK_STORAGE_KEY, networkPassphrase ?? network);
          } catch { /* network read is best-effort */ }
          resolve(address);
        } catch (err) {
          reject(new WalletError('Wallet connection failed', err));
        }
      },
      onClosed: () => reject(new WalletError('Wallet modal closed')),
    });
  });
}

export async function getConnectedAddress(): Promise<WalletAddress | null> {
  const saved = storage.get(ADDRESS_STORAGE_KEY);
  if (!saved) return null;
  try {
    const kit = getKit();
    const { address } = await kit.getAddress();
    return address ?? null;
  } catch {
    return saved;
  }
}

export function getStoredAddress(): WalletAddress | null {
  return storage.get(ADDRESS_STORAGE_KEY);
}

export function disconnectWallet(): void {
  try { getKit().disconnect(); } catch { /* ignore */ }
  storage.remove(WALLET_STORAGE_KEY);
  storage.remove(ADDRESS_STORAGE_KEY);
  storage.remove(NETWORK_STORAGE_KEY);
}

export async function signTransaction(xdrEnvelope: string): Promise<string> {
  const address = getStoredAddress();
  if (!address) throw new WalletError('No wallet connected');
  const { signedTxXdr } = await getKit().signTransaction(xdrEnvelope, {
    networkPassphrase: NETWORK,
    address,
  });
  return signedTxXdr;
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 3) return address;
  return `${address.slice(0, chars + 1)}…${address.slice(-chars)}`;
}

export function fromStroops(stroops: bigint | string, decimals = 7): string {
  const n = BigInt(stroops);
  const divisor = 10n ** BigInt(decimals);
  const whole = n / divisor;
  const frac  = n % divisor;
  return `${whole}.${frac.toString().padStart(decimals, '0')}`;
}

export function toStroops(display: string, decimals = 7): bigint {
  const [whole = '0', frac = ''] = display.split('.');
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || '0');
}
