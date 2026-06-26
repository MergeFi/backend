import { STROOPS_PER_UNIT } from './constants';

export function stroopsToDisplay(stroops: string | bigint, decimals = 2): string {
  const n = BigInt(stroops);
  const whole = n / STROOPS_PER_UNIT;
  const frac  = n % STROOPS_PER_UNIT;
  const fracStr = frac.toString().padStart(7, '0').slice(0, decimals);
  return `${whole.toLocaleString()}.${fracStr}`;
}

export function displayToStroops(display: string): bigint {
  const [whole = '0', frac = ''] = display.replace(/,/g, '').split('.');
  const fracPadded = frac.padEnd(7, '0').slice(0, 7);
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(fracPadded || '0');
}

export function formatUSDC(stroops: string | bigint, showSymbol = true): string {
  const value = stroopsToDisplay(stroops, 2);
  return showSymbol ? `${value} USDC` : value;
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 3) return address;
  return `${address.slice(0, chars + 1)}…${address.slice(-chars)}`;
}

export function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('en-GB', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  });
}

export function formatDateTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('en-GB', {
    day:    '2-digit',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(days: number): string {
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} yr`;
}

export function basisPointsToPercent(bps: number, decimals = 2): string {
  return `${(bps / 100).toFixed(decimals)}%`;
}

export function formatOracleValue(value: string, dataType: string): string {
  const raw = BigInt(value);
  const whole = raw / 10_000_000n;
  const frac = raw % 10_000_000n;
  const n = Number(whole) + Number(frac) / 1e7;
  switch (dataType) {
    case 'weather':
    case 'rainfall':
      return `${n.toFixed(2)} mm`;
    case 'temperature':
      return `${n.toFixed(2)} °C`;
    case 'flight':
      return `${Math.round(n)} min delay`;
    case 'defi':
      if (n === 1) return 'Exploit detected';
      if (n === 0) return 'No exploit';
      return `Unknown (${n.toFixed(0)})`;
    case 'unknown':
      return n.toFixed(4);
    default:
      return n.toFixed(4);
  }
}

export function timeLeft(endEpochSeconds: number): string {
  const diff = endEpochSeconds - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'Expired';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m left`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h left`;
  return `${Math.floor(diff / 86400)}d left`;
}

export function utilizationColor(rate: number): string {
  if (rate < 0.5) return 'text-emerald-400';
  if (rate < 0.8) return 'text-amber-400';
  return 'text-red-400';
}

export function estimatePremium(coverageDisplay: string, premiumRateBps: number): string {
  const coverageStroops = displayToStroops(coverageDisplay || '0');
  const premiumStroops = (coverageStroops * BigInt(premiumRateBps)) / 10_000n;
  return stroopsToDisplay(premiumStroops, 2);
}
