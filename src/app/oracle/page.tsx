'use client';

import { useAllOracleReadings } from '@/hooks/useOracle';
import { FullPageSpinner } from '@/components/LoadingSpinner';
import { Badge } from '@/components/Badge';
import { formatOracleValue, formatDateTime } from '@/lib/format';
import { oracleKeyLabel, confidenceLabel, confidenceColour } from '@/lib/oracle';

export default function OraclePage() {
  const { readings, loading, error, refetch } = useAllOracleReadings();

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Oracle Status</h1>
          <p className="mt-1 text-sm text-gray-400">
            Live data feeds from Open-Meteo, AviationStack, and on-chain monitors
          </p>
        </div>
        <button
          onClick={refetch}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-400 hover:border-white/20 hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      {loading && <FullPageSpinner />}

      {error && (
        <div className="mt-8 rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && readings.length === 0 && (
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center text-gray-500">
          No oracle readings available. The oracle worker may not have run yet.
        </div>
      )}

      {!loading && readings.length > 0 && (
        <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="p-4">Key</th>
                <th className="p-4">Type</th>
                <th className="p-4">Value</th>
                <th className="p-4">Confidence</th>
                <th className="p-4">Source</th>
                <th className="p-4">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="p-4 font-mono text-xs text-gray-300 max-w-[200px] truncate">
                    {oracleKeyLabel(r.key)}
                  </td>
                  <td className="p-4">
                    <Badge label={r.dataType} variant="teal" />
                  </td>
                  <td className="p-4 font-semibold text-white">
                    {formatOracleValue(r.value, r.dataType)}
                  </td>
                  <td className={`p-4 text-xs font-semibold ${confidenceColour(r.confidence)}`}>
                    {r.confidence}% · {confidenceLabel(r.confidence)}
                  </td>
                  <td className="p-4 text-xs text-gray-400">{r.source}</td>
                  <td className="p-4 text-xs text-gray-500">{formatDateTime(r.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="mb-4 text-sm font-semibold text-white">Data Sources</h2>
        <ul className="space-y-2 text-sm text-gray-400">
          <li><span className="font-mono text-teal-400">open-meteo</span> — Free weather API. Rainfall and temperature for any lat/lng. Updated hourly.</li>
          <li><span className="font-mono text-teal-400">aviationstack</span> — Flight delay data. Keyed by flight number and departure date.</li>
          <li><span className="font-mono text-teal-400">on-chain</span> — Stellar network events. DeFi exploit flags submitted by protocol monitors.</li>
        </ul>
      </div>
    </main>
  );
}
