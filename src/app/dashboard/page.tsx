'use client';

import { useWallet } from '@/hooks/useWallet';
import { usePolicies } from '@/hooks/usePolicies';
import { ConnectWalletPrompt } from '@/components/ConnectWalletPrompt';
import { PolicyCard } from '@/components/PolicyCard';
import { SkeletonCard } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { formatUSDC } from '@/lib/format';
import { StatsCard } from '@/components/StatsCard';
import Link from 'next/link';

export default function DashboardPage() {
  const { address, connected } = useWallet();
  const { policies, loading }  = usePolicies(address);

  if (!connected) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-20">
        <ConnectWalletPrompt message="Connect your wallet to view your dashboard" />
      </main>
    );
  }

  const active   = policies.filter((p) => p.status === 'Active');
  const totalCov = active.reduce((sum, p) => sum + BigInt(p.coverage), 0n);
  const totalPaid = active.reduce((sum, p) => sum + BigInt(p.premiumPaid), 0n);

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-400 font-mono">{address}</p>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatsCard label="Active policies" value={active.length.toString()} />
        <StatsCard label="Total policies"  value={policies.length.toString()} />
        <StatsCard label="Total coverage"  value={formatUSDC(totalCov)} />
        <StatsCard label="Total premiums"  value={formatUSDC(totalPaid)} />
      </div>

      {/* Active policies */}
      <div className="mt-10">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-bold">Active Policies</h2>
          <Link href="/policies" className="text-sm text-teal-400 hover:text-teal-300 transition-colors">
            View all →
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            icon="🛡️"
            title="No active policies"
            description="Browse our insurance products and buy your first policy."
            action={
              <Link href="/" className="rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-400 transition-colors">
                Browse products
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.slice(0, 6).map((p) => <PolicyCard key={p.id} policy={p} />)}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { href: '/claims',  icon: '📋', title: 'Claim History',    desc: 'View all your submitted claims and their status.' },
          { href: '/oracle',  icon: '🌐', title: 'Oracle Status',    desc: 'Live data feeds powering the trigger conditions.' },
          { href: '/pools',   icon: '💧', title: 'Risk Pools',       desc: 'Provide liquidity and earn yield as an underwriter.' },
        ].map(({ href, icon, title, desc }) => (
          <Link
            key={href}
            href={href}
            className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-all hover:border-white/20 hover:bg-white/[0.05]"
          >
            <span className="text-2xl">{icon}</span>
            <div>
              <p className="font-semibold text-white">{title}</p>
              <p className="mt-1 text-xs text-gray-400 leading-relaxed">{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
