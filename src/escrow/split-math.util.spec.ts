import { BadRequestException } from '@nestjs/common';
import {
  apportionBasisPoints,
  splitStroops,
  TOTAL_BASIS_POINTS,
} from './split-math.util';

describe('apportionBasisPoints', () => {
  it('sums to exactly 10,000 basis points', () => {
    const bps = apportionBasisPoints([33.33, 33.33, 33.34]);
    expect(bps.reduce((a, b) => a + b, 0)).toBe(TOTAL_BASIS_POINTS);
  });

  it('normalizes naive rounding for repeating-decimal percentages', () => {
    // Math.round(33.333*100) = 3333 for all three, summing to 9999 — the
    // apportionment must hand the missing basis point to the largest remainder.
    const bps = apportionBasisPoints([33.333, 33.333, 33.334]);
    expect(bps).toEqual([3333, 3333, 3334]);
    expect(bps.reduce((a, b) => a + b, 0)).toBe(TOTAL_BASIS_POINTS);
  });

  it('keeps every basis point positive for tiny shares', () => {
    const bps = apportionBasisPoints([0.01, 99.99]);
    expect(bps[0]).toBeGreaterThan(0);
    expect(bps.reduce((a, b) => a + b, 0)).toBe(TOTAL_BASIS_POINTS);
  });

  it('rejects an empty percentage list', () => {
    expect(() => apportionBasisPoints([])).toThrow(BadRequestException);
  });
});

describe('splitStroops', () => {
  it('reproduces the issue repro exactly (100.0000000 -> 1,000,000,000 stroops)', () => {
    const shares = splitStroops(1_000_000_000n, [3333, 3333, 3334]);
    expect(shares).toEqual([333_300_000n, 333_300_000n, 333_400_000n]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(1_000_000_000n);
  });

  it('allocates the rounding remainder so the sum is exact', () => {
    const shares = splitStroops(1_000_000_001n, [5000, 5000]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(1_000_000_001n);
  });

  it('splits a non-divisible amount across uneven thirds exactly', () => {
    const total = 10_000_000_007n; // 1000.0000007
    const shares = splitStroops(total, [3333, 3333, 3334]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(total);
  });

  it('rejects basis points that do not sum to 10,000', () => {
    expect(() => splitStroops(1_000_000_000n, [3333, 3333, 3333])).toThrow(
      BadRequestException,
    );
  });
});
