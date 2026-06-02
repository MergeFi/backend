'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { fetchUserClaims } from '@/lib/api';
import { ConnectWalletPrompt } from '@/components/ConnectWalletPrompt';
import { ClaimHistoryTable } from '@/components/ClaimHistoryTable';
import { FullPageSpinner } from '@/components/LoadingSpinner';
import type { Claim } from '@/types';

export default function ClaimsPage() {
  const { address, connected } = useWallet();
  const [claims,   setClaims]  = useState<Claim[]>([]);
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    fetchUserClaims(address)
      .then(setClaims)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load claims'))
      .finally(() => setLoading(false));
  }, [address]);

  if (!connected) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-20">
        <ConnectWalletPrompt message="Connect your wallet to view your claims" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <h1 className="text-2xl font-bold">Claim History</h1>
      <p className="mt-1 text-sm text-gray-400">
        All claims submitted from your connected wallet
      </p>

      {loading ? (
        <FullPageSpinner />
      ) : error ? (
        <div className="mt-8 rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-400">
          {error}
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <ClaimHistoryTable claims={claims} />
        </div>
      )}
    </main>
  );
}
