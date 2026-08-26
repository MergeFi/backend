import { BadRequestException } from '@nestjs/common';

/** One hundred percent expressed in basis points (hundredths of a percent). */
export const TOTAL_BASIS_POINTS = 10_000;

/**
 * Converts floating-point percentages into integer basis points that sum to
 * exactly {@link TOTAL_BASIS_POINTS} (100.00%).
 *
 * Naively rounding each percentage independently (`Math.round(p * 100)`) can
 * leave the total a few basis points off 10,000 (e.g. three-way splits at
 * repeating-decimal percentages), which would silently under- or over-fund
 * the contract. This apportions the leftover/overage to the recipients whose
 * independent rounding diverged the most, so the integer vector handed to the
 * contract always represents exactly 100%.
 */
export function apportionBasisPoints(percentages: number[]): number[] {
  if (percentages.length === 0) {
    throw new BadRequestException('At least one percentage is required');
  }

  const sum = percentages.reduce((total, p) => total + p, 0);
  if (Math.abs(sum - 100) > 0.01) {
    throw new BadRequestException(
      `Percentages must sum to 100, got ${sum.toFixed(2)}`,
    );
  }

  const bps = percentages.map((p) => Math.round(p * 100));
  const delta = TOTAL_BASIS_POINTS - bps.reduce((sum, b) => sum + b, 0);

  // Distance between each rounded basis point and the exact quota. A positive
  // error means the recipient was rounded down (owed the leftover); negative
  // means rounded up (over-represented).
  const errors = percentages.map((p, i) => ({
    index: i,
    error: p * 100 - bps[i],
  }));

  if (delta > 0) {
    errors.sort((a, b) => b.error - a.error || a.index - b.index);
    for (let i = 0; i < delta; i++) {
      bps[errors[i % errors.length].index] += 1;
    }
  } else if (delta < 0) {
    errors.sort((a, b) => a.error - b.error || a.index - b.index);
    for (let i = 0; i < -delta; i++) {
      bps[errors[i % errors.length].index] -= 1;
    }
  }

  return bps;
}

/**
 * Splits `totalStroops` into integer stroop shares proportional to `bps`
 * (which must sum to exactly {@link TOTAL_BASIS_POINTS}).
 *
 * The returned shares always sum to `totalStroops` exactly. Each share is
 * `floor(totalStroops * bps / 10000)`, with the leftover stroops handed out
 * by the largest-remainder method so no remainder is ever lost or invented.
 */
export function splitStroops(totalStroops: bigint, bps: number[]): bigint[] {
  if (bps.length === 0) {
    throw new BadRequestException('At least one recipient is required');
  }
  const bpsTotal = bps.reduce((sum, b) => sum + b, 0);
  if (bpsTotal !== TOTAL_BASIS_POINTS) {
    throw new BadRequestException(
      `Basis points must sum to ${TOTAL_BASIS_POINTS}, got ${bpsTotal}`,
    );
  }

  const scale = BigInt(TOTAL_BASIS_POINTS);
  const shares = bps.map((b) => (totalStroops * BigInt(b)) / scale);
  const remainder = totalStroops - shares.reduce((sum, s) => sum + s, 0n);

  const remainders = bps.map((b, i) => ({
    index: i,
    remainder: (totalStroops * BigInt(b)) % scale,
  }));

  // Largest-remainder allocation: give the leftover stroops to the recipients
  // with the largest fractional remainder (ties broken by larger share, then
  // by original order).
  remainders.sort((a, b) => {
    if (a.remainder > b.remainder) return -1;
    if (a.remainder < b.remainder) return 1;
    if (shares[a.index] > shares[b.index]) return -1;
    if (shares[a.index] < shares[b.index]) return 1;
    return a.index - b.index;
  });

  for (let i = 0; i < Number(remainder); i++) {
    shares[remainders[i % remainders.length].index] += 1n;
  }

  return shares;
}
