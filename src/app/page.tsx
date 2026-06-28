'use client';

import { useState, useMemo, useEffect } from 'react';
import { useProducts } from '@/hooks/useProducts';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useDebounce } from '@/hooks/useDebounce';
import { fetchProtocolStats } from '@/lib/api';
import { formatUSDC } from '@/lib/format';
import { ProductCard } from '@/components/ProductCard';
import { Skeleton, SkeletonCard } from '@/components/Skeleton';
import { LogoWordmark } from '@/components/Logo';
import { SearchBar } from '@/components/SearchBar';
import { CategoryFilter } from '@/components/CategoryFilter';
import { EmptyState } from '@/components/EmptyState';
import type { Category } from '@/types';

type CategoryFilterValue = Category | 'all';

function StatValue({ loading, failed, children }: { loading: boolean; failed: boolean; children: React.ReactNode }) {
  if (loading) return <Skeleton className="mx-auto h-9 w-28" />;
  if (failed)  return <p className="text-3xl font-black text-teal-400">—</p>;
  return <p className="text-3xl font-black text-teal-400">{children}</p>;
}

export default function HomePage() {
  const { products, loading, error, refetch } = useProducts();
  const [searchQuery, setSearchQuery]   = useState('');
  const [category, setCategory]         = useLocalStorage<CategoryFilterValue>('ps_category_filter', 'all');
  const debouncedQuery                  = useDebounce(searchQuery, 250);

  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError,   setStatsError]   = useState(false);
  const [totalCoverage, setTotalCoverage] = useState<string | null>(null);
  const [totalPayouts,  setTotalPayouts]  = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    setStatsError(false);
    fetchProtocolStats()
      .then((stats) => {
        if (cancelled) return;
        setTotalCoverage(stats.totalCoverage);
        setTotalPayouts(stats.totalPayouts);
      })
      .catch(() => { if (!cancelled) setStatsError(true); })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const activeProductCount = useMemo(
    () => products.filter((p) => p.status === 'Active').length,
    [products],
  );

  const filteredProducts = useMemo(() => {
    let result = products;
    if (category !== 'all') {
      result = result.filter((p) => p.category === category);
    }
    const q = debouncedQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false),
      );
    }
    return result;
  }, [products, category, debouncedQuery]);

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* Hero */}
      <section className="border-b border-white/10 px-6 py-20 text-center">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex justify-center">
            <LogoWordmark size={40} />
          </div>
          <span className="mb-4 inline-block rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-teal-400">
            Parametric insurance on Stellar
          </span>
          <h1 className="mt-4 text-5xl font-bold tracking-tight">
            Insurance that pays out{' '}
            <span className="text-teal-400">automatically</span>
          </h1>
          <p className="mt-6 text-lg text-gray-400 max-w-2xl mx-auto">
            When the trigger condition is met — drought, flight delay, storm, DeFi exploit —
            the smart contract pays you in USDC within seconds.
            No claims form. No adjuster. No waiting.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm text-gray-500">
            <span>⚡ Seconds, not weeks</span>
            <span>·</span>
            <span>🌍 MoneyGram cash-out globally</span>
            <span>·</span>
            <span>🔒 Soroban smart contracts</span>
            <span>·</span>
            <span>💵 USDC payouts</span>
          </div>
        </div>
      </section>

      {/* Product marketplace */}
      <section className="mx-auto max-w-7xl px-6 py-16">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Insurance Products</h2>
          <p className="mt-1 text-sm text-gray-500">Live on Stellar testnet · Payouts in USDC</p>
        </div>

        <CategoryFilter value={category} onChange={setCategory} className="mb-4" />
        <SearchBar
          onSearch={setSearchQuery}
          placeholder="Search products…"
          className="mb-8 max-w-md"
        />

        {loading ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-400">
            <p>{error}</p>
            <button
              onClick={refetch}
              className="mt-3 rounded-lg border border-red-500/30 px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Try again
            </button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="No products found"
            description={debouncedQuery
              ? `No products match "${debouncedQuery}". Try a different search or category.`
              : 'No products in this category yet.'}
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {filteredProducts.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="border-t border-white/10 bg-white/[0.02] px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-10 text-center text-2xl font-bold">How it works</h2>
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { n: '01', title: 'Choose a product', desc: 'Select an insurance product — crop rainfall, flight delay, natural disaster, or DeFi protocol cover.' },
              { n: '02', title: 'Pay premium in USDC', desc: 'Connect your Stellar wallet. Your premium is locked in the smart contract as collateral.' },
              { n: '03', title: 'Oracle monitors', desc: 'NOAA, AviationStack, and on-chain monitors feed verified data to the Oracle Verifier contract every hour.' },
              { n: '04', title: 'Automatic payout', desc: 'Trigger confirmed → contract transfers your coverage to your wallet. No form, no adjuster, no delay.' },
            ].map((step) => (
              <li key={step.n} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <span className="text-3xl font-black text-teal-500/30">{step.n}</span>
                <p className="mt-3 font-semibold text-white">{step.title}</p>
                <p className="mt-2 text-sm text-gray-400 leading-relaxed">{step.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Stats */}
      <section className="border-t border-white/10 px-6 py-12">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-6 text-center sm:grid-cols-4">
          <div>
            <StatValue loading={statsLoading} failed={statsError}>
              {totalCoverage !== null ? formatUSDC(totalCoverage, false) : null}
            </StatValue>
            <p className="mt-1 text-sm text-gray-500">Total coverage issued</p>
          </div>
          <div>
            <StatValue loading={loading} failed={!!error}>
              {activeProductCount}
            </StatValue>
            <p className="mt-1 text-sm text-gray-500">Active products</p>
          </div>
          <div>
            <StatValue loading={statsLoading} failed={statsError}>
              {totalPayouts !== null ? formatUSDC(totalPayouts, false) : null}
            </StatValue>
            <p className="mt-1 text-sm text-gray-500">Total payouts</p>
          </div>
          <div>
            <p className="text-3xl font-black text-teal-400">$0.00001</p>
            <p className="mt-1 text-sm text-gray-500">Per transaction</p>
          </div>
        </div>
      </section>
    </main>
  );
}
