/**
 * Emitted when an on-chain payment or activity occurs that modifies a contributor's
 * reputation stats (bounty PAID, milestone partial release, pool reward assign).
 */
export const REPUTATION_RECOMPUTE_EVENT = 'reputation.recompute';

export interface ReputationRecomputePayload {
  userId: string;
}
