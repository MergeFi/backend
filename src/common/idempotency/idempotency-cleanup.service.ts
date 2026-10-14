import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { IdempotencyKey } from '../entities/idempotency-key.entity';

const IDEMPOTENCY_CLEANUP_LOCK_KEY = 0x59676702;

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
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async removeExpired(): Promise<void> {
    // Single-runner across replicas — a plain @Cron fired on every replica
    // (#586); the Postgres advisory lock means only the holder sweeps.
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      const [{ locked }] = await qr.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [IDEMPOTENCY_CLEANUP_LOCK_KEY],
      );
      if (!locked) return;
      try {
        const result = await this.repo.delete({
          expiresAt: LessThan(new Date()),
        });
        if (result.affected) {
          this.logger.log(
            `Removed ${result.affected} expired idempotency key(s)`,
          );
        }
      } finally {
        await qr.query('SELECT pg_advisory_unlock($1)', [
          IDEMPOTENCY_CLEANUP_LOCK_KEY,
        ]);
      }
    } finally {
      await qr.release();
    }
  }
}
