import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { BountiesService } from './bounties.service';
import { runWithAdvisoryLock } from '../common/advisory-lock';

/**
 * Runs `BountiesService.expireOverdue()` on a schedule.
 *
 * Without this the deadline sweep is dead code — nothing in the application
 * ever calls it, so a bounty past its deadline keeps its
 * OPEN/FUNDED/CLAIMED status forever (#152). Mirrors the hourly `@Cron`
 * sweep in `IdempotencyCleanupService`.
 *
 * Expiry also refunds the escrow of expired bounties that were funded (#794),
 * and retries refunds that failed on an earlier sweep.
 */
@Injectable()
export class BountyExpiryScheduler {
  private readonly logger = new Logger(BountyExpiryScheduler.name);

  constructor(
    private readonly bountiesService: BountiesService,
    private readonly configService: ConfigService<AppConfig, true>,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweepOverdueBounties(): Promise<void> {
    if (!this.configService.get('schedulers', { infer: true }).enabled) {
      return;
    }

    const lockId = 847291;
    const work = async (): Promise<void> => {
      const expired = await this.bountiesService.expireOverdue();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} overdue bounty(ies)`);
      }
    };

    if (!this.dataSource?.isInitialized) {
      await work();
      return;
    }

    // Lock and unlock on one connection (#784), so the lock is always released.
    const outcome = await runWithAdvisoryLock(this.dataSource, lockId, work);
    if (!outcome.acquired) {
      this.logger.debug('Skipping sweep: another instance holds advisory lock');
    }
  }
}
