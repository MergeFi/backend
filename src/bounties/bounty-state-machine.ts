import { BountyStatus } from '../common/enums';

/**
 * Valid forward transitions for a bounty's lifecycle:
 *
 *   open -> funded -> claimed -> in_review -> merged -> paid
 *                                                    \-> refunded
 *   (open|funded|claimed) -> expired
 *   (open|funded) -> refunded
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
  [BountyStatus.MERGED]: [BountyStatus.PAID, BountyStatus.REFUNDED],
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
