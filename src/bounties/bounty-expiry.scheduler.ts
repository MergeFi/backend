import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  SchedulerLockId,
  SchedulerLockService,
} from '../common/locks/scheduler-lock.service';
import { BountiesService } from './bounties.service';

/**
 * Runs `BountiesService.expireOverdue()` on a schedule.
 *
 * Without this the deadline sweep is dead code — nothing in the application
 * ever calls it, so a bounty past its deadline keeps its
 * OPEN/FUNDED/CLAIMED status forever (#152). Mirrors the hourly `@Cron`
 * sweep in `IdempotencyCleanupService`.
 *
 * This is deliberately independent of (and runs prior to) any on-chain
 * auto-refund follow-up for expired FUNDED bounties (#26): the local status
 * flip has to happen regardless.
 */
@Injectable()
export class BountyExpiryScheduler {
  private readonly logger = new Logger(BountyExpiryScheduler.name);

  constructor(
    private readonly bountiesService: BountiesService,
    @Optional()
    private readonly schedulerLockService: SchedulerLockService = new SchedulerLockService(),
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweepOverdueBounties(): Promise<void> {
    await this.schedulerLockService.withSchedulerLock(
      SchedulerLockId.BOUNTY_EXPIRY,
      'sweep',
      async () => {
        const expired = await this.bountiesService.expireOverdue();
        if (expired > 0) {
          this.logger.log(`Expired ${expired} overdue bounty(ies)`);
        }
      },
    );
  }
}
