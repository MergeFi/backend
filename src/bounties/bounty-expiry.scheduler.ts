import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BountiesService } from './bounties.service';

// Postgres advisory-lock key for the bounty-expiry sweep — an arbitrary int
// identifying this job. Any other replica trying the same key finds it held.
const BOUNTY_EXPIRY_LOCK_KEY = 0x59676701;

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
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweepOverdueBounties(): Promise<void> {
    // A plain @Cron fires on EVERY replica — with N replicas the sweep ran N
    // times an hour, racing the same rows (#586). A Postgres advisory lock
    // makes it single-runner: pg_try_advisory_lock returns false on every
    // replica except the one holding the lock, which then sweeps alone.
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      const [{ locked }] = await qr.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [BOUNTY_EXPIRY_LOCK_KEY],
      );
      if (!locked) return; // another replica holds the sweep

      try {
        const expired = await this.bountiesService.expireOverdue();
        if (expired > 0) {
          this.logger.log(`Expired ${expired} overdue bounty(ies)`);
        }
      } finally {
        await qr.query('SELECT pg_advisory_unlock($1)', [
          BOUNTY_EXPIRY_LOCK_KEY,
        ]);
      }
    } finally {
      await qr.release();
    }
  }
}
