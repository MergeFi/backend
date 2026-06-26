'use client';

import { useState } from 'react';
import type { Product } from '@/types';
import { BuyPolicyModal } from './BuyPolicyModal';
import { Badge } from './Badge';
import { TriggerConditionBadge } from './TriggerConditionBadge';
import { basisPointsToPercent, formatUSDC } from '@/lib/format';
import { CATEGORY_ICONS } from '@/lib/constants';

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const [open, setOpen] = useState(false);
  const icon            = CATEGORY_ICONS[product.category] ?? '🛡️';
  const isActive        = product.status === 'Active';

  return (
    <>
      <div className={`flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-all hover:border-white/20 hover:bg-white/[0.05] ${!isActive ? 'opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <span className="text-3xl">{icon}</span>
          <div className="flex gap-2">
            <Badge label={product.category} variant="teal" />
            {!isActive && <Badge label={product.status} />}
          </div>
        </div>

        <h3 className="mt-4 text-base font-semibold leading-snug text-white">{product.name}</h3>

        <div className="mt-2">
          <TriggerConditionBadge product={product} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-white/5 p-3">
            <dt className="text-[10px] uppercase tracking-widest text-gray-500">Premium</dt>
            <dd className="mt-0.5 font-semibold text-teal-400">
              {basisPointsToPercent(product.premiumRate)}
            </dd>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <dt className="text-[10px] uppercase tracking-widest text-gray-500">Max Coverage</dt>
            <dd className="mt-0.5 font-semibold text-white">{formatUSDC(product.coverageMax)}</dd>
          </div>
        </dl>

        <button
          onClick={() => setOpen(true)}
          disabled={!isActive}
          className={`mt-6 w-full rounded-xl py-2.5 text-sm font-semibold transition-colors ${
            isActive
              ? 'bg-teal-500 text-white hover:bg-teal-400'
              : 'bg-gray-700 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isActive ? 'Buy Policy' : product.status === 'Paused' ? 'Temporarily unavailable' : 'No longer available'}
        </button>
      </div>

      {open && <BuyPolicyModal product={product} onClose={() => setOpen(false)} />}
    </>
  );
}
