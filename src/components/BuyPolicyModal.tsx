'use client';

import { useState, useEffect } from 'react';
import type { Product } from '@/types';
import { useWallet } from '@/hooks/useWallet';
import { displayToStroops, basisPointsToPercent } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { invokeBuyPolicy } from '@/lib/contract';
import { buildRainfallKey, buildFlightKey } from '@/lib/oracle';
import { Modal } from './Modal';
import { StepProgress } from './ProgressBar';
import { useToast } from '@/context/ToastContext';

interface Props {
  product: Product;
  onClose: () => void;
}

const STEPS = ['Configure', 'Review', 'Sign'];

export function BuyPolicyModal({ product, onClose }: Props) {
  const { address, connect, connecting } = useWallet();
  const { show: showToast }             = useToast();

  const [coverage,  setCoverage]  = useState('');
  const [duration,  setDuration]  = useState(String(Math.min(30, product.maxDuration)));
  const [oracleKey, setOracleKey] = useState('');
  const [step,      setStep]      = useState(0);
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState('');

  // Crop builder state
  const [lat, setLat] = useState('-0.0917');
  const [lng, setLng] = useState('34.7679');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);

  // Flight builder state
  const [flightNumber, setFlightNumber] = useState('');
  const [flightDate, setFlightDate] = useState(new Date().toISOString().split('T')[0]);

  const coverageNum   = parseFloat(coverage) || 0;
  const premiumPct    = product.premiumRate / 10_000;
  const estimatedPrem = (coverageNum * premiumPct).toFixed(2);

  // Automatically build oracle key based on inputs
  useEffect(() => {
    if (product.category === 'crop') {
      const latNum = parseFloat(lat) || 0;
      const lngNum = parseFloat(lng) || 0;
      setOracleKey(buildRainfallKey(latNum, lngNum, year, month));
    } else if (product.category === 'flight') {
      setOracleKey(buildFlightKey(flightNumber.trim(), flightDate));
    } else if (product.category === 'defi') {
      setOracleKey('defi');
    }
  }, [product.category, lat, lng, year, month, flightNumber, flightDate]);

  function validate(): string {
    const cov = parseFloat(coverage);
    if (isNaN(cov) || cov < parseFloat(product.coverageMin) || cov > parseFloat(product.coverageMax)) {
      return `Coverage must be between ${product.coverageMin} and ${product.coverageMax} USDC`;
    }
    const dur = parseInt(duration, 10);
    if (isNaN(dur) || dur < 1 || dur > product.maxDuration) {
      return `Duration must be between 1 and ${product.maxDuration} days`;
    }
    if (product.category === 'crop') {
      if (isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) {
        return 'Valid latitude and longitude are required';
      }
    } else if (product.category === 'flight') {
      if (!flightNumber.trim()) {
        return 'Flight number is required';
      }
      if (!flightDate) {
        return 'Flight date is required';
      }
    } else if (product.category === 'disaster' || product.category === 'health') {
      if (!oracleKey.trim() || oracleKey.trim().length > 9) {
        return 'Oracle key is required and must be at most 9 characters';
      }
    }
    return '';
  }

  async function handleBuy() {
    if (!address) { await connect(); return; }
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    if (step < 2) { setStep((s) => s + 1); return; }

    setBusy(true);
    setError('');
    try {
      const txHash = await invokeBuyPolicy(
        address,
        product.id,
        BigInt(displayToStroops(coverage)),
        oracleKey.trim(),
        parseInt(duration, 10),
      );
      showToast(`Policy activation transaction ${txHash.slice(0, 8)}… submitted`, 'success');
      onClose();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Buy — ${product.name}`} onClose={onClose}>
      <StepProgress steps={STEPS} current={step} />

      <div className="mt-6 space-y-4">
        {step === 0 && (
          <>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                Coverage Amount (USDC)
              </label>
              <input
                type="number"
                value={coverage}
                onChange={(e) => { setCoverage(e.target.value); setError(''); }}
                placeholder={`${product.coverageMin} – ${product.coverageMax}`}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                Duration (days, max {product.maxDuration})
              </label>
              <input
                type="number"
                value={duration}
                onChange={(e) => { setDuration(e.target.value); setError(''); }}
                min={1}
                max={product.maxDuration}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
              />
            </div>

            {product.category === 'crop' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      placeholder="e.g. -0.0917"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={lng}
                      onChange={(e) => setLng(e.target.value)}
                      placeholder="e.g. 34.7679"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                      Month
                    </label>
                    <select
                      value={month}
                      onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm focus:border-teal-500 focus:outline-none text-white appearance-none"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m} className="bg-gray-900 text-white">
                          {new Date(2026, m - 1).toLocaleString('en-US', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                      Year
                    </label>
                    <select
                      value={year}
                      onChange={(e) => setYear(parseInt(e.target.value, 10))}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm focus:border-teal-500 focus:outline-none text-white appearance-none"
                    >
                      {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() + i).map((y) => (
                        <option key={y} value={y} className="bg-gray-900 text-white">
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  Computed Key: <span className="font-mono text-teal-400">{oracleKey}</span>
                </div>
              </div>
            )}

            {product.category === 'flight' && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                    Flight Number
                  </label>
                  <input
                    type="text"
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value)}
                    placeholder="e.g. KQ100"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                    Date
                  </label>
                  <input
                    type="date"
                    value={flightDate}
                    onChange={(e) => setFlightDate(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
                  />
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  Computed Key: <span className="font-mono text-teal-400">{oracleKey}</span>
                </div>
              </div>
            )}

            {product.category === 'defi' && (
              <div className="space-y-2">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Oracle Key (Fixed)
                </label>
                <div className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-mono text-gray-400 select-all">
                  defi
                </div>
              </div>
            )}

            {(product.category !== 'crop' && product.category !== 'flight' && product.category !== 'defi') && (
              <div className="space-y-2">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Oracle Key
                </label>
                <input
                  type="text"
                  value={oracleKey}
                  onChange={(e) => { setOracleKey(e.target.value); setError(''); }}
                  placeholder='e.g. "kis2606" for Kisumu June 2026'
                  maxLength={9}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-gray-500">Max 9 chars (Soroban Symbol)</p>
                <div className="mt-2 text-xs text-gray-400">
                  Computed Key: <span className="font-mono text-teal-400">{oracleKey}</span>
                </div>
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3 text-sm">
            <h4 className="font-semibold text-white">Review your policy</h4>
            <div className="flex justify-between text-gray-400">
              <span>Product</span>
              <span className="text-white font-medium">{product.name}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Coverage</span>
              <span className="text-emerald-400 font-semibold">{coverageNum.toFixed(2)} USDC</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Duration</span>
              <span className="text-white">{duration} days</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Oracle key</span>
              <span className="font-mono text-xs text-white">{oracleKey}</span>
            </div>
            <div className="flex justify-between border-t border-white/10 pt-3 text-gray-400">
              <span>Premium ({basisPointsToPercent(product.premiumRate)})</span>
              <span className="font-bold text-white">{estimatedPrem} USDC</span>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 text-sm text-gray-400">
            <p>Your Stellar wallet will prompt you to sign the policy transaction.</p>
            <p className="text-xs">
              Premium of <strong className="text-white">{estimatedPrem} USDC</strong> will be deducted from your wallet balance.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div className="mt-6 flex gap-3">
        {step > 0 && (
          <button
            onClick={() => setStep((s) => s - 1)}
            disabled={busy}
            className="w-1/3 rounded-xl border border-white/10 py-2.5 font-semibold text-gray-300 hover:border-white/20 hover:text-white disabled:opacity-60 transition-colors"
          >
            Back
          </button>
        )}
        <button
          onClick={handleBuy}
          disabled={busy || connecting}
          className="flex-1 rounded-xl bg-teal-500 py-2.5 font-semibold text-white hover:bg-teal-400 disabled:opacity-60 transition-colors"
        >
          {connecting  ? 'Connecting wallet…' :
           busy        ? 'Submitting…' :
           !address    ? 'Connect Wallet' :
           step === 2  ? 'Sign & Confirm' :
           step === 1  ? 'Confirm details' :
           'Next'}
        </button>
      </div>
    </Modal>
  );
}
