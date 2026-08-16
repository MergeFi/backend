import { BountyStatus } from '../common/enums';

/**
 * Valid forward transitions for a bounty's lifecycle:
 *
 *   open -> funded -> claimed -> in_review -> merged -> release_pending -> paid
 *                                                    \-> refunded
 *   (open|funded|claimed) -> expired
 *   (open|funded) -> refunded
 *   release_pending -> release_pending (retry on escrow failure)
 */
export const BOUNTY_TRANSITIONS: Record<BountyStatus, BountyStatus[]> = {
  [BountyStatus.OPEN]: [
    BountyStatus.FUNDED,
    BountyStatus.EXPIRED,
    BountyStatus.REFUNDED,
  ],
  [BountyStatus.FUNDED]: [
    BountyStatus.CLAIMED,
    BountyStatus.EXPIRED,
    BountyStatus.REFUNDED,
  ],
  [BountyStatus.CLAIMED]: [
    BountyStatus.IN_REVIEW,
    BountyStatus.EXPIRED,
    BountyStatus.REFUNDED,
  ],
  [BountyStatus.IN_REVIEW]: [
    BountyStatus.MERGED,
    BountyStatus.CLAIMED,
    BountyStatus.REFUNDED,
  ],
  [BountyStatus.MERGED]: [BountyStatus.RELEASE_PENDING],
  [BountyStatus.RELEASE_PENDING]: [
    BountyStatus.PAID,
    BountyStatus.RELEASE_PENDING, // Allow retry on escrow failure
    BountyStatus.REFUNDED,
  ],
  [BountyStatus.PAID]: [],
  [BountyStatus.REFUNDED]: [],
  [BountyStatus.EXPIRED]: [BountyStatus.REFUNDED],
};

export class InvalidBountyTransitionError extends Error {
  constructor(from: BountyStatus, to: BountyStatus) {
    super(`Cannot transition bounty from "${from}" to "${to}"`);
    this.name = 'InvalidBountyTransitionError';
  }
}

export function canTransition(from: BountyStatus, to: BountyStatus): boolean {
  return BOUNTY_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: BountyStatus, to: BountyStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidBountyTransitionError(from, to);
  }
}
