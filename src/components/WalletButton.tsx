'use client';

import { useWalletContext } from '@/context/WalletContext';
import { shortenAddress } from '@/lib/stellar';

interface WalletButtonProps {
  className?: string;
}

export function WalletButton({ className }: WalletButtonProps) {
  const { address, connected, connecting, connect, disconnect } = useWalletContext();

  if (connected && address) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-gray-300">
          {shortenAddress(address)}
        </span>
        <button
          onClick={disconnect}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-gray-400 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 transition-all"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={connecting}
      className={`rounded-full bg-teal-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-400 disabled:opacity-60 transition-colors ${className ?? ''}`}
    >
      {connecting ? 'Connecting…' : 'Connect Wallet'}
    </button>
  );
}
