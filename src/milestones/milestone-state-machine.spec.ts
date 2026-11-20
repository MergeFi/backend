import { MilestoneStatus } from '../common/enums';
import {
  assertTransition,
  canTransition,
  InvalidMilestoneTransitionError,
} from './milestone-state-machine';

describe('milestone state machine', () => {
  it('allows the standard happy-path progression', () => {
    expect(canTransition(MilestoneStatus.OPEN, MilestoneStatus.FUNDED)).toBe(
      true,
    );
    expect(
      canTransition(MilestoneStatus.FUNDED, MilestoneStatus.IN_PROGRESS),
    ).toBe(true);
    expect(
      canTransition(MilestoneStatus.IN_PROGRESS, MilestoneStatus.COMPLETED),
    ).toBe(true);
  });

  it('allows closing from open, funded, or in_progress', () => {
    for (const status of [
      MilestoneStatus.OPEN,
      MilestoneStatus.FUNDED,
      MilestoneStatus.IN_PROGRESS,
    ]) {
      expect(canTransition(status, MilestoneStatus.CLOSED)).toBe(true);
    }
  });

  it('disallows skipping states, e.g. open -> completed directly', () => {
    expect(
      canTransition(MilestoneStatus.OPEN, MilestoneStatus.COMPLETED),
    ).toBe(false);
  });

  it('disallows any transition out of a terminal COMPLETED state', () => {
    expect(
      canTransition(MilestoneStatus.COMPLETED, MilestoneStatus.OPEN),
    ).toBe(false);
    expect(
      canTransition(MilestoneStatus.COMPLETED, MilestoneStatus.CLOSED),
    ).toBe(false);
  });

  it('disallows any transition out of a terminal CLOSED state', () => {
    expect(canTransition(MilestoneStatus.CLOSED, MilestoneStatus.OPEN)).toBe(
      false,
    );
  });

  it('assertTransition throws InvalidMilestoneTransitionError on an illegal move', () => {
    expect(() =>
      assertTransition(MilestoneStatus.OPEN, MilestoneStatus.COMPLETED),
    ).toThrow(InvalidMilestoneTransitionError);
  });

  it('assertTransition does not throw on a legal move', () => {
    expect(() =>
      assertTransition(MilestoneStatus.OPEN, MilestoneStatus.FUNDED),
    ).not.toThrow();
  });
});
