'use client';

import { use } from 'react';
import { usePolicy } from '@/hooks/usePolicies';
import { useClaim } from '@/hooks/useClaim';
import { useWallet } from '@/hooks/useWallet';
import { OracleDataWidget } from '@/components/OracleDataWidget';
import { Badge } from '@/components/Badge';
import { FullPageSpinner } from '@/components/LoadingSpinner';
import { formatUSDC, formatDate, timeLeft, basisPointsToPercent } from '@/lib/format';
import { useToast } from '@/context/ToastContext';

export default function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }            = use(params);
  const { policy, loading } = usePolicy(id);
  const { address }       = useWallet();
  const { show: toast }   = useToast();
  const { step, error: claimError, submit: submitClaim } = useClaim();

  if (loading) return <FullPageSpinner />;

  if (!policy) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-20 text-center">
        <p className="text-gray-400">Policy not found.</p>
      </main>
    );
  }

  async function handleClaim() {
    if (!address) { toast('Connect your wallet first', 'warning'); return; }
    await submitClaim(address, id);
    if (!claimError) toast('Claim submitted successfully', 'success');
    else toast(claimError, 'error');
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
        {[
          { label: 'Policy holder',  value: `${policy.policyholder.slice(0, 8)}…${policy.policyholder.slice(-4)}` },
          { label: 'Coverage',       value: formatUSDC(policy.coverage) },
          { label: 'Premium paid',   value: formatUSDC(policy.premiumPaid) },
          { label: 'Oracle key',     value: policy.oracleKey },
          { label: 'Start date',     value: formatDate(policy.startTime) },
          { label: 'Expiry',         value: `${formatDate(policy.endTime)} (${timeLeft(policy.endTime)})` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs uppercase tracking-widest text-gray-500">{label}</p>
            <p className="mt-1.5 font-mono text-sm text-white break-all">{value}</p>
          </div>
        ))}
      </div>

      {policy.oracleKey && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-400">Live Oracle Reading</h2>
          <OracleDataWidget oracleKey={policy.oracleKey} />
        </div>
      )}

      {canClaim && (
        <div className="mt-8 rounded-2xl border border-teal-500/20 bg-teal-500/5 p-6">
          <h2 className="font-semibold text-white">Submit a Claim</h2>
          <p className="mt-2 text-sm text-gray-400">
            If the oracle has confirmed the trigger condition was met, you can submit a claim.
            The smart contract will verify and pay out automatically.
          </p>
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
        </div>
      )}
    </main>
  );
}
