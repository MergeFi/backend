import {
  PercentageSplit,
  validatePercentageSplits,
} from '../common/validators/split-percentage.validator';

export type SplitLike = PercentageSplit;

/**
 * Validates that a set of team member split percentages sums to exactly 100
 * (within tolerance), with every entry in `(0, 100]`.
 *
 * Thin wrapper over the shared {@link validatePercentageSplits} — the single
 * implementation also used by `EscrowService.assertValidSplits` (#167).
 */
export function validateSplitPercentages(splits: SplitLike[]): void {
  validatePercentageSplits(splits, 'team member split');
}
