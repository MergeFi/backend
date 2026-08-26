import { BadRequestException } from '@nestjs/common';

/** Anything carrying a `percentage` field — a team member split or an escrow split recipient. */
export interface PercentageSplit {
  percentage: number;
}

/** Percentages are considered to sum to 100 when within this absolute tolerance. */
export const SPLIT_PERCENTAGE_TOLERANCE = 0.01;

/**
 * Single source of truth for percentage-split validation (#167).
 *
 * Both places this codebase collects percentage-based splits —
 * `CreateTeamDto.members` (via `TeamsService`) and `SplitReleaseDto.recipients`
 * (via `EscrowService.splitRelease`) — must answer the same question: is this a
 * non-empty list where every entry is in `(0, 100]` and the total is 100 within
 * {@link SPLIT_PERCENTAGE_TOLERANCE}? Previously `team-split.util.ts` and
 * `EscrowService.assertValidSplits` each reimplemented it, and the two drifted
 * in strictness. This function is now the only implementation; both callers
 * delegate here.
 *
 * @param splits list of `{ percentage }` entries to validate
 * @param label noun used in error messages (e.g. `"team member split"`,
 *   `"split release"`); defaults to `"split"`
 */
export function validatePercentageSplits(
  splits: PercentageSplit[],
  label = 'split',
): void {
  if (splits.length === 0) {
    throw new BadRequestException(`At least one ${label} entry is required`);
  }
  if (splits.some((s) => s.percentage <= 0 || s.percentage > 100)) {
    throw new BadRequestException(
      `Each ${label} percentage must be greater than 0 and at most 100`,
    );
  }
  const total = splits.reduce((sum, s) => sum + s.percentage, 0);
  if (Math.abs(total - 100) > SPLIT_PERCENTAGE_TOLERANCE) {
    throw new BadRequestException(
      `${label} percentages must sum to 100, got ${total.toFixed(2)}`,
    );
  }
}
