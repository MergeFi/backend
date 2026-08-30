import { Bounty, Issue } from '../entities';
import { BountyStatus } from '../enums';

/** Bounty statuses that count as a completed (merged) contribution. */
export const MERGED_BOUNTY_STATUSES: readonly BountyStatus[] = [
  BountyStatus.MERGED,
  BountyStatus.PAID,
];

export interface ContributorStats {
  /** Bounties the contributor claimed — the denominator for `completionRate`. */
  claimedCount: number;
  /** Claimed bounties that reached MERGED or PAID. */
  mergedCount: number;
  /** `mergedCount / claimedCount * 100` (0 when nothing was claimed). */
  completionRate: number;
  /** Mean hours between `claimedAt` and `mergedAt` over merged bounties (0 when none). */
  avgReviewTimeHours: number;
  /** Count of the passed issues per repository primary language. */
  languages: Record<string, number>;
  /** De-duplicated repository owners across the passed issues. */
  orgs: string[];
}

/**
 * Single implementation of the "contributor lifetime stats" computation that
 * `ReputationService.computeAndSave` and `AnalyticsService.forContributor`
 * both need (#166). Previously each service re-implemented the merge rate,
 * the (byte-for-byte identical) average-review-time arithmetic, and the
 * per-language / per-org reduction over a separately re-fetched set of the
 * same issues.
 *
 * Callers pass the contributor's claimed bounties and the linked issues
 * (each with its `repository` relation loaded). Anything caller-specific —
 * paid earnings, on-time delivery %, payout heatmaps, top clients,
 * distinct-repo counts — stays in the caller.
 */
export function computeContributorStats(
  claimedBounties: Bounty[],
  issues: Issue[],
): ContributorStats {
  const merged = claimedBounties.filter((b) =>
    MERGED_BOUNTY_STATUSES.includes(b.status),
  );

  const completionRate =
    claimedBounties.length > 0
      ? (merged.length / claimedBounties.length) * 100
      : 0;

  const reviewTimes = merged
    .filter((b) => b.claimedAt && b.mergedAt)
    .map((b) => (b.mergedAt!.getTime() - b.claimedAt!.getTime()) / 3_600_000);
  const avgReviewTimeHours =
    reviewTimes.length > 0
      ? reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length
      : 0;

  const languages = issues.reduce<Record<string, number>>((acc, issue) => {
    const lang = issue.repository?.primaryLanguage;
    if (lang) acc[lang] = (acc[lang] ?? 0) + 1;
    return acc;
  }, {});

  const orgs = [
    ...new Set(
      issues
        .map((issue) => issue.repository?.owner)
        .filter((owner): owner is string => Boolean(owner)),
    ),
  ];

  return {
    claimedCount: claimedBounties.length,
    mergedCount: merged.length,
    completionRate,
    avgReviewTimeHours,
    languages,
    orgs,
  };
}
