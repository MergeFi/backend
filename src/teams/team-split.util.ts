import { BadRequestException } from '@nestjs/common';

export interface SplitLike {
  percentage: number;
}

/** Validates that a set of team member split percentages sums to exactly 100 (within tolerance). */
export function validateSplitPercentages(splits: SplitLike[]): void {
  if (splits.length === 0) {
    throw new BadRequestException('A team must have at least one member split');
  }
  if (splits.some((s) => s.percentage <= 0 || s.percentage > 100)) {
    throw new BadRequestException(
      'Each split percentage must be between 0 and 100',
    );
  }
  const total = splits.reduce((sum, s) => sum + s.percentage, 0);
  if (Math.abs(total - 100) > 0.01) {
    throw new BadRequestException(
      `Team split percentages must sum to 100, got ${total.toFixed(2)}`,
    );
  }
}

/** Computes each member's absolute payout share for a given total bounty amount. */
export function computeSplitShares(
  totalAmount: number,
  splits: SplitLike[],
): number[] {
  validateSplitPercentages(splits);
  return splits.map(
    (s) => Math.round(((totalAmount * s.percentage) / 100) * 1e7) / 1e7,
  );
}
