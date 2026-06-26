'use client';

import { useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { usePolicies } from '@/hooks/usePolicies';
import { PolicyCard } from '@/components/PolicyCard';
import { ConnectWalletPrompt } from '@/components/ConnectWalletPrompt';
import { SkeletonCard } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/Badge';
import Link from 'next/link';

type Filter = 'All' | 'Active' | 'Expired' | 'Claimed';

const FILTERS: Filter[] = ['All', 'Active', 'Expired', 'Claimed'];

export default function PoliciesPage() {
  const { address, connected } = useWallet();
  const { policies, loading, error, refetch } = usePolicies(address);
  const [filter, setFilter]    = useState<Filter>('All');

  if (!connected) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-20">
        <ConnectWalletPrompt message="Connect your wallet to view your policies" />
      </main>
    );
  }

  const statusCounts = policies.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  const filterCounts: Record<Filter, number> = {
    All:     policies.length,
    Active:  statusCounts['Active']  ?? 0,
    Expired: statusCounts['Expired'] ?? 0,
    Claimed: statusCounts['Claimed'] ?? 0,
  };

  const filteredPolicies = filter === 'All'
    ? policies
    : policies.filter((p) => p.status === filter);

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">My Policies</h1>
          <p className="mt-1 text-sm text-gray-400">{filteredPolicies.length} total policies</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {Object.entries(statusCounts).map(([status, count]) => (
            <span key={status} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
              <Badge label={status} />
              <span className="text-gray-400">{count}</span>
            </span>
          ))}
        </div>
      </div>

      {policies.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {FILTERS.map((tab) => {
            const count = filterCounts[tab];
            const isActive = filter === tab;
            return (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-teal-500 text-white'
                    : count === 0
                      ? 'border border-white/5 text-gray-600 cursor-default opacity-50'
                      : 'border border-white/10 text-gray-400 hover:border-white/20 hover:text-white'
                }`}
              >
                {tab}
                <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : error && policies.length === 0 ? (
        <EmptyState
          icon="⚠️"
          title="Failed to load policies"
          description={error}
          action={
            <button
              onClick={() => void refetch()}
              className="rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-400 transition-colors"
            >
              Try again
            </button>
          }
        />
      ) : policies.length === 0 ? (
        <EmptyState
          icon="📋"
          title="No policies yet"
          description="Buy your first parametric insurance policy from the products marketplace."
          action={
            <Link href="/" className="rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-400 transition-colors">
              Browse products
            </Link>
          }
        />
      ) : filteredPolicies.length === 0 ? (
        <EmptyState
          icon="🔍"
          title={`No ${filter.toLowerCase()} policies`}
          description="Try a different filter to see your other policies."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPolicies.map((p) => <PolicyCard key={p.id} policy={p} />)}
        </div>
      )}
    </main>
  );
}
