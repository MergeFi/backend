import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
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
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async removeExpired(): Promise<void> {
    const result = await this.repo.delete({
      expiresAt: LessThan(new Date()),
    });
    if (result.affected) {
      this.logger.log(`Removed ${result.affected} expired idempotency key(s)`);
    }
  }
}
