'use client';

import { useOracleReading } from '@/hooks/useOracle';
import { LoadingSpinner } from './LoadingSpinner';
import { formatOracleValue, formatDateTime } from '@/lib/format';
import { oracleKeyLabel, confidenceLabel, confidenceColour } from '@/lib/oracle';

interface OracleDataWidgetProps {
  oracleKey: string;
  className?: string;
}

export function OracleDataWidget({ oracleKey, className }: OracleDataWidgetProps) {
  const { reading, loading, error, refetch } = useOracleReading(oracleKey);

  if (loading) {
    return (
      <div className={`flex h-28 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] ${className ?? ''}`}>
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex h-28 flex-col items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-white/[0.03] text-sm ${className ?? ''}`}>
        <p className="text-red-400">{error}</p>
        <button
          onClick={refetch}
          className="rounded-lg border border-white/10 px-3 py-1 text-xs text-gray-400 transition-all hover:border-white/20 hover:text-white active:scale-95"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!reading) {
    return (
      <div className={`flex h-28 flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] text-sm text-gray-500 ${className ?? ''}`}>
        <p>No oracle data</p>
        <button
          onClick={refetch}
          className="rounded-lg border border-white/10 px-3 py-1 text-xs text-gray-400 transition-all hover:border-white/20 hover:text-white active:scale-95"
          aria-label="Refresh oracle data"
        >
          ↻ Refresh
        </button>
      </div>
    );
  }

  const confLabel  = confidenceLabel(reading.confidence);
  const confColour = confidenceColour(reading.confidence);

  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 ${className ?? ''}`}>
      <p className="text-[10px] uppercase tracking-widest text-gray-500">Oracle Reading</p>
      <p className="mt-1 text-xs text-gray-400 truncate">{oracleKeyLabel(oracleKey)}</p>

      <p className="mt-3 text-2xl font-black text-white">
        {formatOracleValue(reading.value, reading.dataType)}
      </p>

      <div className="mt-3 flex items-center justify-between text-[10px] text-gray-500">
        <span>Source: <span className="text-gray-400">{reading.source}</span></span>
        <span className={`font-semibold ${confColour}`}>{confLabel} confidence</span>
      </div>

      <p className="mt-1 text-[10px] text-gray-600">
        {formatDateTime(reading.timestamp)}
      </p>
    </div>
  );
}
