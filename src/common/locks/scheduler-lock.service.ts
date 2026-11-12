import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

export enum SchedulerLockId {
  BOUNTY_EXPIRY = 847291,
  IDEMPOTENCY_CLEANUP = 847292,
}

@Injectable()
export class SchedulerLockService {
  private readonly logger = new Logger(SchedulerLockService.name);

  constructor(
    @Optional() private readonly dataSource?: DataSource,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  /**
   * Executes `fn` guarded by a PostgreSQL session-level advisory lock.
   *
   * A dedicated QueryRunner connection is leased from the pool for the
   * duration of the execution, ensuring that pg_try_advisory_lock and
   * pg_advisory_unlock operate on the same database session.
   *
   * Fails closed on any acquisition error or lock contention.
   */
  async withSchedulerLock<T = void>(
    lockId: SchedulerLockId | number,
    name: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    if (!this.isSchedulerEnabled()) {
      return undefined;
    }

    if (!this.dataSource?.isInitialized) {
      return await fn();
    }

    const queryRunner = this.dataSource.createQueryRunner();
    let lockAcquired = false;

    try {
      await queryRunner.connect();
      const res: unknown = await queryRunner.query(
        'SELECT pg_try_advisory_lock($1) as acquired',
        [lockId],
      );
      if (
        Array.isArray(res) &&
        res.length > 0 &&
        typeof res[0] === 'object' &&
        res[0] !== null &&
        'acquired' in res[0]
      ) {
        lockAcquired = (res[0] as { acquired: unknown }).acquired === true;
      }
    } catch (error) {
      this.logger.error(
        `Failed to acquire advisory lock ${lockId} for ${name}`,
        error,
      );
      lockAcquired = false;
    }

    if (!lockAcquired) {
      this.logger.debug(
        `Skipping ${name}: another instance holds advisory lock`,
      );
      await queryRunner.release().catch(() => {});
      return undefined;
    }

    try {
      return await fn();
    } finally {
      try {
        await queryRunner.query('SELECT pg_advisory_unlock($1)', [lockId]);
      } catch (error) {
        this.logger.error(
          `Failed to release advisory lock ${lockId} for ${name}`,
          error,
        );
      } finally {
        await queryRunner.release().catch(() => {});
      }
    }
  }

  private isSchedulerEnabled(): boolean {
    if (this.configService) {
      const configValue =
        this.configService.get<boolean | string>('runSchedulers') ??
        this.configService.get<boolean | string>('RUN_SCHEDULERS');
      if (typeof configValue === 'boolean') {
        return configValue;
      }
      if (typeof configValue === 'string') {
        const normalized = configValue.trim().toLowerCase();
        return normalized !== 'false' && normalized !== '0';
      }
    }

    if (process.env.RUN_SCHEDULERS !== undefined) {
      const normalized = process.env.RUN_SCHEDULERS.trim().toLowerCase();
      return normalized !== 'false' && normalized !== '0';
    }

    return true;
  }
}
