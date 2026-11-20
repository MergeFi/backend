import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { AppConfig } from '../../config/configuration';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { runWithAdvisoryLock } from '../advisory-lock';
import { ADVISORY_LOCK_IDS } from '../advisory-lock-ids';

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
    private readonly configService: ConfigService<AppConfig, true>,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async removeExpired(): Promise<void> {
    if (!this.configService.get('schedulers', { infer: true }).enabled) {
      return;
    }

    const lockId = ADVISORY_LOCK_IDS.IDEMPOTENCY_CLEANUP;
    const work = async (): Promise<void> => {
      const result = await this.repo.delete({
        expiresAt: LessThan(new Date()),
      });
      if (result.affected) {
        this.logger.log(
          `Removed ${result.affected} expired idempotency key(s)`,
        );
      }
    };

    if (!this.dataSource?.isInitialized) {
      await work();
      return;
    }

    // Lock and unlock on one connection (#784), so the lock is always released.
    const outcome = await runWithAdvisoryLock(this.dataSource, lockId, work);
    if (!outcome.acquired) {
      this.logger.debug(
        'Skipping cleanup: another instance holds advisory lock',
      );
    }
  }
}
