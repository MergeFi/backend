import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { IdempotencyKey } from '../entities/idempotency-key.entity';

/**
 * Sweeps expired idempotency_keys rows (#16). Retention itself is set per
 * row at insert time via IDEMPOTENCY_KEY_TTL_MS
 * (IdempotencyInterceptor.claim) — this just reclaims storage for rows
 * whose `expiresAt` has already passed; it plays no part in correctness
 * (a request replaying an already-deleted key simply executes as new).
 */
@Injectable()
export class IdempotencyCleanupService {
  private readonly logger = new Logger(IdempotencyCleanupService.name);

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async removeExpired(): Promise<void> {
    if (process.env.RUN_SCHEDULERS === 'false') {
      return;
    }

    const lockId = 847292;
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
      this.logger.debug(
        'Skipping cleanup: another instance holds advisory lock',
      );
      return;
    }

    try {
      const result = await this.repo.delete({
        expiresAt: LessThan(new Date()),
      });
      if (result.affected) {
        this.logger.log(`Removed ${result.affected} expired idempotency key(s)`);
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
