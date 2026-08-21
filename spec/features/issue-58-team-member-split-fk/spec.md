## Overview

`TeamMemberSplit.user` cascades on delete, unlike the careful `RESTRICT`/`SET NULL` treatment every other user-linked financial relation in this schema received:

```ts
// src/common/entities/team-member-split.entity.ts:24-29
@ManyToOne(() => User, { onDelete: 'CASCADE' })
@JoinColumn()
user: User;

@Column()
userId: string;
```

Compare to `Bounty.claimedBy`/`Bounty.sponsor`/`Bounty.team` (all `onDelete: 'SET NULL'`, `bounty.entity.ts:29-46`) and `Payment.recipient` (`onDelete: 'SET NULL'`, `payment.entity.ts:32-34`) — every other place a `User` is referenced from a money-relevant row, deleting that `User` leaves the referencing row intact with the FK nulled out, exactly the principle this schema's own FK-hardening migration established for `Escrow`/`Payment` (`1784272650000-EscrowFkIntegrityAndSponsorId.ts`). `TeamMemberSplit` is the one place that principle wasn't applied: deleting a `User` row **deletes their `TeamMemberSplit` row outright**, silently shrinking the team's composition.

The consequence: `TeamMemberSplit.percentage` values are only meaningful as a set — `team-split.util.ts`'s `validateSplitPercentages` requires them to sum to exactly 100 at *creation* time (`team-split.util.ts:8-23`), but nothing re-validates that invariant later, and nothing needs to, as long as the set of rows never changes after creation. The `CASCADE` breaks that assumption: if any team member's `User` row is ever deleted (account closure, GDPR-style deletion request, an admin cleanup, a future account-merge feature) after the team was formed, their `TeamMemberSplit` row disappears with them, and the remaining splits no longer sum to 100.

Trace what happens the next time that team gets paid. `BountiesService.markMergedAndRelease` loads `team.splits` fresh at merge time (`bounties.service.ts:101-119`) and passes them straight to `EscrowService.splitRelease`, which calls `assertValidSplits` (`escrow.service.ts:269-284`) before doing anything else:

```ts
// src/escrow/escrow.service.ts:275-279
const total = recipients.reduce((sum, r) => sum + r.percentage, 0);
if (Math.abs(total - 100) > 0.01) {
  throw new BadRequestException(`Split percentages must sum to 100, got ${total.toFixed(2)}`);
}
```

A team originally split 40/30/30 that loses its 30%-member's row to a `CASCADE` delete now sums to 70 — `assertValidSplits` correctly rejects it, but that means `splitRelease` throws, which means `markMergedAndRelease` throws (before it ever reaches its own `assertTransition(bounty.status, PAID)` at the end) — the bounty is left stuck in `MERGED` with a `LOCKED` escrow and no application-level way to retry, for exactly the reasons described in the companion "stuck MERGED bounty" issue, except triggered here by a data-integrity gap on an entirely different table than that issue's own root cause. A PR that was correctly merged, for a team that did the work, ends up permanently blocked from paying out because one member's account was deleted at some point after the team was formed — a scenario with no adversarial intent required at all.

## Requirements

- Change `TeamMemberSplit.user`'s relation from `onDelete: 'CASCADE'` to `onDelete: 'RESTRICT'` — a `TeamMemberSplit` is a financial commitment (a promised percentage of a future payout) in exactly the same sense a `Payment` is a record of money that already moved; deleting the `User` it belongs to should refuse, not silently unbalance the team, mirroring `Payment.escrow`'s existing `RESTRICT` reasoning.
- Write the accompanying migration using the same `replaceForeignKeyOnDelete`-style approach already established in `1784272650000-EscrowFkIntegrityAndSponsorId.ts`.
- Since `RESTRICT` alone means "can't delete a user who's on any team" forever (which may be too strong once a team's bounty has already fully paid out and the split no longer matters going forward), consider whether team membership should instead be soft-deletable/deactivatable independent of the `User` row itself, so a genuinely-necessary user deletion doesn't get permanently blocked by stale team memberships on already-completed bounties. This is a design decision worth surfacing explicitly in the PR rather than picking `RESTRICT` and calling it done without considering the account-deletion use case it would then block.
- Add a test: create a team with 3 members summing to 100%, delete one member's `User` row, assert either (a) the delete is rejected (if `RESTRICT` is the chosen fix) or (b) whatever softer mechanism is chosen still results in `team.splits` continuing to sum to 100% for any *not-yet-paid* bounty using that team.

## Acceptance Criteria

- [ ] Deleting a `User` who is a member of a team whose bounty payout hasn't completed no longer silently removes their `TeamMemberSplit` row and desyncs the split sum.
- [ ] A migration implements the FK change.
- [ ] The tension between "must not silently break team payouts" and "must not permanently block legitimate account deletion" is explicitly addressed in the PR, not just papered over with a blanket `RESTRICT`.
- [ ] A test reproduces the pre-fix scenario (team member deleted, subsequent `markMergedAndRelease` throws and leaves the bounty stuck) and proves it no longer happens post-fix.

## Additional Notes

**Precise references:** `src/common/entities/team-member-split.entity.ts:24-29` (the bug), `src/common/entities/bounty.entity.ts:29-46` (the correctly-`SET NULL`'d sibling relations on the same general "user referenced from a financial entity" pattern), `src/common/entities/payment.entity.ts:20-34` (the `RESTRICT` pattern this fix should most closely mirror, given `TeamMemberSplit` is arguably closer in spirit to "a financial commitment" than `Payment.recipient` is), `src/teams/team-split.util.ts:8-23` (`validateSplitPercentages`, the invariant this cascade silently breaks after the fact), `src/bounties/bounties.service.ts:101-119` (`markMergedAndRelease`'s team-split branch, where the broken invariant surfaces), `src/escrow/escrow.service.ts:269-284` (`assertValidSplits`, correctly rejecting the now-broken split — the guard works exactly as designed, it's the upstream data integrity that's the actual bug).

**Test/reproduction plan:**
```ts
const team = await teamsService.create({ name: 't', members: [
  { userId: userA.id, percentage: 40 }, { userId: userB.id, percentage: 30 }, { userId: userC.id, percentage: 30 },
]});
const bounty = await bountiesService.create({ ...dto });
await bountiesService.fund(bounty.id, funderAddress);
await teamsService.assignToBounty(team.id, bounty.id);
await userRepo.delete(userB.id);   // pre-fix: cascades, team now has 2 splits summing to 70

await bountiesService.claim(bounty.id, userA.id);
await bountiesService.markInReview(bounty.id, prUrl, prNumber);
await expect(bountiesService.markMergedAndRelease(bounty.id)).rejects.toThrow();
// pre-fix: throws BadRequestException from assertValidSplits, bounty stuck at MERGED with LOCKED escrow
// post-fix: userRepo.delete(userB.id) itself was rejected (or handled) before ever reaching this state
```

**Cross-references:** same underlying pattern — a cascade relation this codebase's FK-hardening migration didn't reach — as the companion "Bounty.issue uses onDelete: CASCADE" issue, on a different table. Also directly compounds with the companion "stuck MERGED bounty" issue: this is a second, independent root cause (alongside plain transient release failures) that can put a bounty into that exact stuck state, so any retry mechanism built to address that issue needs to also be reachable for this failure mode, not just the escrow-call-failure case that issue primarily describes.
