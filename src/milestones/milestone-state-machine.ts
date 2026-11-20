import { MilestoneStatus } from '../common/enums';

/**
 * Valid forward transitions for a milestone's lifecycle:
 *
 *   open -> funded -> in_progress -> completed
 *   (open|funded|in_progress) -> closed
 */
export const MILESTONE_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> =
  {
    [MilestoneStatus.OPEN]: [MilestoneStatus.FUNDED, MilestoneStatus.CLOSED],
    [MilestoneStatus.FUNDED]: [
      MilestoneStatus.IN_PROGRESS,
      MilestoneStatus.CLOSED,
    ],
    [MilestoneStatus.IN_PROGRESS]: [
      MilestoneStatus.COMPLETED,
      MilestoneStatus.CLOSED,
    ],
    [MilestoneStatus.COMPLETED]: [],
    [MilestoneStatus.CLOSED]: [],
  };

export class InvalidMilestoneTransitionError extends Error {
  constructor(from: MilestoneStatus, to: MilestoneStatus) {
    super(`Cannot transition milestone from "${from}" to "${to}"`);
    this.name = 'InvalidMilestoneTransitionError';
  }
}

export function canTransition(from: MilestoneStatus, to: MilestoneStatus): boolean {
  return MILESTONE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: MilestoneStatus, to: MilestoneStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidMilestoneTransitionError(from, to);
  }
}
