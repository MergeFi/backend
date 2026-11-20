import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

const logger = new Logger('AdvisoryLock');

export type AdvisoryLockOutcome<T> =
  | { acquired: true; result: T }
  | { acquired: false };

/**
 * Runs `work` while holding a session-level Postgres advisory lock (#784).
 *
 * pg_try_advisory_lock is owned by the connection that took it, so the lock
 * and its unlock must run on the same connection. A pooled query may land on
 * another connection, leaving the lock held for good. This takes one
 * QueryRunner, runs lock, work and unlock on it, and releases it at the end.
 */
export async function runWithAdvisoryLock<T>(
  dataSource: DataSource,
  lockId: number,
  work: () => Promise<T>,
): Promise<AdvisoryLockOutcome<T>> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    const rows = await runner.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockId],
    );
    if (!rows?.[0]?.acquired) {
      return { acquired: false };
    }
    try {
      const result = await work();
      return { acquired: true, result };
    } finally {
      const unlock = await runner.query(
        'SELECT pg_advisory_unlock($1) AS released',
        [lockId],
      );
      if (!unlock?.[0]?.released) {
        logger.error(`Advisory lock ${lockId} was not held by this connection at unlock`);
      }
    }
  } finally {
    await runner.release();
  }
}
