import { BadRequestException } from '@nestjs/common';

/** Anything carrying a `percentage` field — a team member split or an escrow split recipient. */
export interface PercentageSplit {
  percentage: number;
  userId?: string;
  recipientId?: string;
  recipientAddress?: string;
}

/** Percentages are considered to sum to 100 when within this absolute tolerance. */
export const SPLIT_PERCENTAGE_TOLERANCE = 0.01;

/**
 * Single source of truth for percentage-split validation (#167, #358).
 *
 * Both places this codebase collects percentage-based splits —
 * `CreateTeamDto.members` (via `TeamsService`) and `SplitReleaseDto.recipients`
 * (via `EscrowService.splitRelease`) — must answer the same questions:
 * 1. Is this a non-empty list where every entry is in `(0, 100]` and the total is 100 within
 *    {@link SPLIT_PERCENTAGE_TOLERANCE}?
 * 2. Are all entries distinct without duplicate recipients/members (#358)?
 *
 * Previously `team-split.util.ts` and `EscrowService.assertValidSplits` each reimplemented it,
 * and identity fields were never inspected for duplicates.
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

  // Duplicate member/recipient guard (#358)
  const seenIdentities = new Set<string>();
  for (const s of splits) {
    const identityKey = s.userId ?? s.recipientId ?? s.recipientAddress;
    if (identityKey) {
      if (seenIdentities.has(identityKey)) {
        throw new BadRequestException(
          `Duplicate ${label} entry detected for identity: ${identityKey}`,
        );
      }
      seenIdentities.add(identityKey);
    }
  }
}
