'use client';

import { use } from 'react';
import { usePolicy } from '@/hooks/usePolicies';
import { useWallet } from '@/hooks/useWallet';
import { OracleDataWidget } from '@/components/OracleDataWidget';
import { PolicyStatusTimeline } from '@/components/PolicyStatusTimeline';
import { TransactionLink } from '@/components/TransactionLink';
import { Badge } from '@/components/Badge';
import { FullPageSpinner } from '@/components/LoadingSpinner';
import { formatUSDC, formatDate, timeLeft, shortenAddress } from '@/lib/format';
import { CopyButton } from '@/components/CopyButton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ClaimStatus } from '@/components/ClaimStatus';

export default function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }            = use(params);
  const { policy, loading } = usePolicy(id);
  const { address }       = useWallet();
  const { show: toast }   = useToast();
  const { step, claim, error: claimError, submit: submitClaim } = useClaim();

  if (loading) return <FullPageSpinner />;

  if (!policy) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-20 text-center">
        <p className="text-gray-400">Policy not found.</p>
      </main>
    );
  }

  const canClaim = policy.status === 'Active' && address === policy.policyholder;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-6 flex items-center gap-4">
        <h1 className="text-2xl font-bold flex-1">
          {policy.product?.name ?? `Policy ${id.slice(0, 8)}…`}
        </h1>
        <Badge label={policy.status} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Policyholder — truncated display with copy affordance for the full address */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-widest text-gray-500">Policy holder</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="font-mono text-sm text-white">{shortenAddress(policy.policyholder)}</span>
            <CopyButton text={policy.policyholder} label="Copy address" />
          </div>
        </div>

        {[
          { label: 'Coverage',   value: formatUSDC(policy.coverage) },
          { label: 'Premium paid', value: formatUSDC(policy.premiumPaid) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs uppercase tracking-widest text-gray-500">{label}</p>
            <p className="mt-1.5 font-mono text-sm text-white break-all">{value}</p>
          </div>
        ))}

        {/* Oracle key — full value with inline copy button */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-widest text-gray-500">Oracle key</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="font-mono text-sm text-white break-all">{policy.oracleKey}</span>
            <CopyButton text={policy.oracleKey} label="Copy key" />
          </div>
        </div>

        {[
          { label: 'Start date', value: formatDate(policy.startTime) },
          { label: 'Expiry',     value: `${formatDate(policy.endTime)} (${timeLeft(policy.endTime)})` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs uppercase tracking-widest text-gray-500">{label}</p>
            <p className="mt-1.5 font-mono text-sm text-white break-all">{value}</p>
          </div>
        ))}
      </div>

      {policy.contractTxHash && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-widest text-gray-500">Purchase transaction</p>
          <TransactionLink txHash={policy.contractTxHash} className="mt-1.5" />
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold text-gray-400">Policy Timeline</h2>
        <PolicyStatusTimeline policy={policy} />
      </div>

      {policy.oracleKey && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-400">Live Oracle Reading</h2>
          <ErrorBoundary
            fallback={
              <p className="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                Oracle data unavailable — unable to parse the latest reading.
              </p>
            }
          >
            <OracleDataWidget oracleKey={policy.oracleKey} />
          </ErrorBoundary>
        </div>
      )}

      {canClaim && (
        <div className="mt-8 rounded-2xl border border-teal-500/20 bg-teal-500/5 p-6">
          <h2 className="font-semibold text-white">Submit a Claim</h2>
          <p className="mt-2 text-sm text-gray-400">
            If the oracle has confirmed the trigger condition was met, you can submit a claim.
            The smart contract will verify and pay out automatically.
          </p>
          <div className="mt-4">
            <ClaimStatus policyId={id} />
          </div>
          <button
            onClick={handleClaim}
            disabled={step === 'submitting' || step === 'polling'}
            className="mt-4 rounded-xl bg-teal-500 px-6 py-2.5 font-semibold text-white hover:bg-teal-400 disabled:opacity-60 transition-colors"
          >
            {step === 'submitting' ? 'Submitting…' :
             step === 'polling'    ? 'Processing…' :
             'Submit Claim'}
          </button>
          {claimError && <p className="mt-3 text-sm text-red-400">{claimError}</p>}
          {step === 'timeout' && (
            <div className="mt-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm text-yellow-300">
              Claim submitted — processing is taking longer than usual. Check your{' '}
              <Link href="/claims" className="underline hover:text-yellow-200 transition-colors">
                claim history
              </Link>{' '}
              for the final status.
            </div>
          )}
          {step === 'done' && claim?.txHash && (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-widest text-gray-500">Payout transaction</p>
              <TransactionLink txHash={claim.txHash} className="mt-1.5" />
            </div>
          )}
        </div>
      )}
    </main>
  );
}
