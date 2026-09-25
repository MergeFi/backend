import {
  PercentageSplit,
  assertUniqueSplitEntries,
  validatePercentageSplits,
} from '../common/validators/split-percentage.validator';

export type SplitLike = PercentageSplit;

export interface TeamMemberSplitLike extends SplitLike {
  userId: string;
}

/**
 * Validates that a set of team member split percentages sums to exactly 100
 * (within tolerance), with every entry in `(0, 100]`, and that no member
 * appears twice (#358).
 *
 * Thin wrapper over the shared {@link validatePercentageSplits} — the single
 * implementation also used by `EscrowService.assertValidSplits` (#167) — and
 * {@link assertUniqueSplitEntries}, shared with `SplitReleaseDto.recipients`.
 */
export function validateSplitPercentages(splits: TeamMemberSplitLike[]): void {
  validatePercentageSplits(splits, 'team member split');
  assertUniqueSplitEntries(splits, (s) => s.userId, 'team member');
}
