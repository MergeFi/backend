import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { AppConfig } from '../config/configuration';
import {
  EscrowReconciliationService,
  ReconciliationSummary,
} from './escrow-reconciliation.service';
import { runWithAdvisoryLock } from '../common/advisory-lock';

/**
 * Runs `EscrowReconciliationService.reconcileAll()` on a schedule (#849).
 *
 * EscrowService records ambiguous failures (a PENDING fund with a tx hash, a
 * LOCKED escrow with `lastFailure`, a diverged split release) for a
 * reconciliation job to repair. Without this nothing reads them, and each
 * stays a row where the database and the chain may disagree. Mirrors
 * `BountyExpiryScheduler`, on a shorter interval because a PENDING escrow
 * blocks its bounty until settled.
 */
@Injectable()
export class EscrowReconciliationScheduler {
  private readonly logger = new Logger(EscrowReconciliationScheduler.name);

  constructor(
    private readonly reconciliation: EscrowReconciliationService,
    private readonly configService: ConfigService<AppConfig, true>,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcileEscrows(): Promise<void> {
    if (!this.configService.get('schedulers', { infer: true }).enabled) {
      return;
    }

    const lockId = 847293;
    const work = async (): Promise<void> => {
      const summary = await this.reconciliation.reconcileAll();
      if (summary.resolved > 0 || summary.unresolved > 0) {
        this.logger.log(this.describe(summary));
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
        'Skipping reconciliation: another instance holds advisory lock',
      );
    }
  }

  private describe(summary: ReconciliationSummary): string {
    return (
      `Reconciled ${summary.resolved} escrow(s); ` +
      `${summary.unresolved} need manual reconciliation`
    );
  }
}
