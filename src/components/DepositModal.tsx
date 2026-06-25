'use client';

import { useState, useEffect } from 'react';
import type { PoolStats } from '@/types';
import { useWallet } from '@/hooks/useWallet';
import { fetchPoolShares } from '@/lib/api';
import { buildDepositTx, submitSignedTransaction } from '@/lib/contract';
import { signTransaction } from '@/lib/stellar';
import { displayToStroops, formatUSDC, stroopsToDisplay } from '@/lib/format';
import { ContractError, toUserMessage } from '@/lib/errors';
import { CATEGORY_LABELS } from '@/lib/constants';
import { Modal } from './Modal';
import { useToast } from '@/context/ToastContext';

interface Props {
  pool:    PoolStats;
  onClose: () => void;
}

function estimateShares(depositStroops: bigint, totalLiquidity: bigint, shareSupply: bigint): bigint {
  if (totalLiquidity === 0n || shareSupply === 0n) return depositStroops;
  return (depositStroops * shareSupply) / totalLiquidity;
}

function depositErrorMessage(err: unknown): string {
  const raw = err instanceof ContractError ? err.message : toUserMessage(err);
  const lower = raw.toLowerCase();
  if (lower.includes('insufficient') || lower.includes('balance')) {
    return 'Insufficient USDC balance to complete this deposit.';
  }
  if (lower.includes('paused') || lower.includes('pause')) {
    return 'This pool is currently paused. Deposits are not accepted.';
  }
  return toUserMessage(err);
}

export function DepositModal({ pool, onClose }: Props) {
  const { address }           = useWallet();
  const { show: showToast }     = useToast();

  const [amount,       setAmount]       = useState('');
  const [shareSupply,  setShareSupply]  = useState<bigint | null>(null);
  const [totalLiquidity, setTotalLiquidity] = useState<bigint | null>(null);
  const [paused,       setPaused]       = useState(false);
  const [loadingShares, setLoadingShares] = useState(true);
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadingShares(true);
    fetchPoolShares(pool.poolId)
      .then((info) => {
        if (cancelled) return;
        setShareSupply(BigInt(info.shareSupply));
        setTotalLiquidity(BigInt(info.totalLiquidity));
        setPaused(info.paused ?? false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(toUserMessage(err));
      })
      .finally(() => { if (!cancelled) setLoadingShares(false); });
    return () => { cancelled = true; };
  }, [pool.poolId]);

  const amountNum     = parseFloat(amount) || 0;
  const depositStroops = amount ? displayToStroops(amount) : 0n;
  const sharesAvailable = shareSupply !== null && totalLiquidity !== null;
  const estimatedShares = sharesAvailable
    ? estimateShares(depositStroops, totalLiquidity, shareSupply)
    : 0n;

  async function handleDeposit() {
    if (!address) return;
    if (paused) { setError('This pool is currently paused. Deposits are not accepted.'); return; }
    if (amountNum <= 0) { setError('Enter a valid USDC amount.'); return; }

    setBusy(true);
    setError('');
    try {
      const unsignedXdr = await buildDepositTx(pool.poolId, depositStroops, address);
      const signedXdr   = await signTransaction(unsignedXdr);
      await submitSignedTransaction(signedXdr);
      showToast(`Deposited — ${stroopsToDisplay(estimatedShares.toString(), 4)} LP shares minted`, 'success');
      onClose();
    } catch (err) {
      setError(depositErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const poolLabel = CATEGORY_LABELS[pool.category] ?? pool.category;

  return (
    <Modal open title={`Deposit — ${poolLabel} Pool`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
            Amount (USDC)
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(''); }}
            placeholder="0.00"
            min={0}
            step="0.01"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <div className="flex justify-between text-gray-400">
            <span>Pool liquidity</span>
            <span className="text-white">{formatUSDC(pool.totalLiquidity)}</span>
          </div>
          <div className="mt-2 flex justify-between text-gray-400">
            <span>APY</span>
            <span className="text-emerald-400 font-semibold">
              {pool.apy != null ? `${(pool.apy * 100).toFixed(2)}%` : '—'}
            </span>
          </div>
          <div className="mt-2 flex justify-between text-gray-400">
            <span>Utilization</span>
            <span className="text-white">
              {pool.utilizationRate != null ? `${(pool.utilizationRate * 100).toFixed(2)}%` : '—'}
            </span>
          </div>
          <div className="mt-2 flex justify-between text-gray-400">
            <span>Estimated LP shares</span>
            <span className="font-semibold text-emerald-400">
              {loadingShares ? '…' : sharesAvailable ? stroopsToDisplay(estimatedShares.toString(), 4) : '—'}
            </span>
          </div>
        </div>

        {paused && (
          <p className="text-sm text-amber-400">This pool is paused. Deposits are temporarily disabled.</p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <button
        onClick={handleDeposit}
        disabled={busy || loadingShares || paused}
        className="mt-6 w-full rounded-xl bg-teal-500 py-2.5 font-semibold text-white hover:bg-teal-400 disabled:opacity-60 transition-colors"
      >
        {busy ? 'Signing & submitting…' : 'Confirm deposit'}
      </button>
    </Modal>
  );
}
