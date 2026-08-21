import { BadRequestException } from '@nestjs/common';

export interface SplitLike {
  percentage: number;
}

/** Validates that a set of split percentages sums to exactly 100 (within tolerance) and each is positive and <= 100. */
export function validateSplitPercentages(
  splits: SplitLike[],
  errorMessagePrefix = 'Team',
): void {
  if (!splits || splits.length === 0) {
    throw new BadRequestException(
      `${errorMessagePrefix === 'Team' ? 'A team' : errorMessagePrefix} must have at least one member split`,
    );
  }
  if (splits.some((s) => s.percentage <= 0 || s.percentage > 100)) {
    throw new BadRequestException(
      'Each split percentage must be between 0 and 100',
    );
  }
  const total = splits.reduce((sum, s) => sum + s.percentage, 0);
  if (Math.abs(total - 100) > 0.01) {
    throw new BadRequestException(
      `${errorMessagePrefix} split percentages must sum to 100, got ${total.toFixed(2)}`,
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
