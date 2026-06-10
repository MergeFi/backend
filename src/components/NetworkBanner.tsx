'use client';

import { STELLAR_NETWORK } from '@/lib/constants';

export function NetworkBanner() {
  if (STELLAR_NETWORK === 'PUBLIC') return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500/10 py-2 text-center text-xs font-semibold text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
      Stellar Testnet — Do not use real funds
    </div>
  );
}
