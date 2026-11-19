import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
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
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweepOverdueBounties(): Promise<void> {
    if (process.env.RUN_SCHEDULERS === 'false') {
      return;
    }

    const lockId = 847291;
    let lockAcquired = true;
    if (this.dataSource?.isInitialized) {
      try {
        const res = await this.dataSource.query(
          'SELECT pg_try_advisory_lock($1) as acquired',
          [lockId],
        );
        lockAcquired = res?.[0]?.acquired ?? true;
      } catch {
        lockAcquired = true;
      }
    }

    if (!lockAcquired) {
      this.logger.debug('Skipping sweep: another instance holds advisory lock');
      return;
    }

    try {
      const expired = await this.bountiesService.expireOverdue();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} overdue bounty(ies)`);
      }
    } finally {
      if (this.dataSource?.isInitialized && lockAcquired) {
        await this.dataSource
          .query('SELECT pg_advisory_unlock($1)', [lockId])
          .catch(() => {});
      }
    }
  }
}
