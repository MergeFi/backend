import { BountyStatus } from '../common/enums';
import {
  assertTransition,
  canTransition,
  InvalidBountyTransitionError,
} from './bounty-state-machine';

describe('bounty state machine', () => {
  it('allows the standard happy-path progression', () => {
    expect(canTransition(BountyStatus.OPEN, BountyStatus.FUNDED)).toBe(true);
    expect(canTransition(BountyStatus.FUNDED, BountyStatus.CLAIMED)).toBe(true);
    expect(canTransition(BountyStatus.CLAIMED, BountyStatus.IN_REVIEW)).toBe(
      true,
    );
    expect(canTransition(BountyStatus.IN_REVIEW, BountyStatus.MERGED)).toBe(
      true,
    );
    expect(canTransition(BountyStatus.MERGED, BountyStatus.PAID)).toBe(true);
  });

  it('allows moving back from in_review to claimed (PR closed without merge)', () => {
    expect(canTransition(BountyStatus.IN_REVIEW, BountyStatus.CLAIMED)).toBe(
      true,
    );
  });

  it('allows refund from open, funded, claimed, in_review, merged, and expired', () => {
    for (const status of [
      BountyStatus.OPEN,
      BountyStatus.FUNDED,
      BountyStatus.CLAIMED,
      BountyStatus.IN_REVIEW,
      BountyStatus.MERGED,
      BountyStatus.EXPIRED,
    ]) {
      expect(canTransition(status, BountyStatus.REFUNDED)).toBe(true);
    }
  });

  it('disallows skipping states, e.g. open -> merged directly', () => {
    expect(canTransition(BountyStatus.OPEN, BountyStatus.MERGED)).toBe(false);
  });

  it('disallows any transition out of a terminal PAID state', () => {
    expect(canTransition(BountyStatus.PAID, BountyStatus.REFUNDED)).toBe(false);
    expect(canTransition(BountyStatus.PAID, BountyStatus.OPEN)).toBe(false);
  });

  it('disallows any transition out of a terminal REFUNDED state', () => {
    expect(canTransition(BountyStatus.REFUNDED, BountyStatus.OPEN)).toBe(false);
  });

  it('assertTransition throws InvalidBountyTransitionError on an illegal move', () => {
    expect(() =>
      assertTransition(BountyStatus.OPEN, BountyStatus.PAID),
    ).toThrow(InvalidBountyTransitionError);
  });

  it('assertTransition does not throw on a legal move', () => {
    expect(() =>
      assertTransition(BountyStatus.OPEN, BountyStatus.FUNDED),
    ).not.toThrow();
  });
});
