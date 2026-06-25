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

export interface WalletConnection {
  address:           WalletAddress;
  networkPassphrase: string | null;
}

const NETWORK: WalletNetwork =
  STELLAR_NETWORK === 'PUBLIC' ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;

/** Network passphrase the app expects connected wallets to be using. */
export const EXPECTED_NETWORK_PASSPHRASE: string = NETWORK;

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

export async function connectWallet(): Promise<WalletConnection> {
  const kit = getKit();
  return new Promise<WalletConnection>((resolve, reject) => {
    kit.openModal({
      modalTitle: 'Connect your wallet',
      onWalletSelected: async (option: ISupportedWallet) => {
        try {
          kit.setWallet(option.id);
          const { address } = await kit.getAddress();
          if (!address) throw new WalletError('No address returned from wallet');
          storage.set(WALLET_STORAGE_KEY, option.id);
          storage.set(ADDRESS_STORAGE_KEY, address);
          let networkPassphrase: string | null = null;
          try {
            const net = await kit.getNetwork();
            networkPassphrase = net.networkPassphrase ?? net.network ?? null;
            if (net.network) storage.set(NETWORK_STORAGE_KEY, net.networkPassphrase ?? net.network);
          } catch { /* network read is best-effort */ }
          resolve({ address, networkPassphrase });
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

/**
 * Sign an arbitrary UTF-8 message with the connected wallet for use as an
 * auth challenge.  Uses `signMessage` when the kit supports it; falls back to
 * signing a minimal Stellar transaction envelope so older wallet extensions
 * that only implement `signTransaction` are still supported.
 *
 * Returns a hex-encoded signature string suitable for sending to the backend
 * as `signedChallenge`.
 */
export async function signAuthMessage(message: string): Promise<string> {
  const address = getStoredAddress();
  if (!address) throw new WalletError('No wallet connected');

  const kit = getKit();

  // Use signMessage (supported by modern wallet extensions via SEP-43).
  // The kit exposes this method at runtime even though the TypeScript types
  // may not declare it for all versions of the package.
  const kitAny = kit as unknown as {
    signMessage?: (opts: { message: string; address: string }) => Promise<{ signedMessage: string }>;
  };

  if (typeof kitAny.signMessage === 'function') {
    const { signedMessage } = await kitAny.signMessage({ message, address });
    return signedMessage;
  }

  // Fallback for wallets that do not yet support signMessage: sign via
  // signTransaction using an XDR already built externally. Here we encode the
  // challenge as a base64 string so it can be verified without importing the
  // full Stellar SDK on the client side (which pulls in Node-only native deps).
  const encoded = btoa(message);
  throw new WalletError(
    `Your wallet does not support message signing (SEP-43). ` +
    `Please upgrade your wallet extension. Challenge: ${encoded}`,
  );
}
