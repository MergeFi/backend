import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Liveness — cheap, always ok. Doesn't touch the DB (#577). */
  getHealth() {
    return {
      status: 'ok',
      service: 'mergefi-backend',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness — actually checks the dependencies. A Postgres-down instance
   * would previously have answered `{status:'ok'}` while every data route
   * 500'd, so orchestrators kept routing traffic to it (#577). Ping the
   * database; report it down so readiness-gated traffic shifts off.
   */
  async getReadiness() {
    const checks: Record<string, 'ok' | 'down'> = {};
    try {
      await this.dataSource.query('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'down';
    }
    const allOk = Object.values(checks).every((v) => v === 'ok');
    return {
      status: allOk ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
