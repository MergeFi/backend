import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, Payment } from '../common/entities';
import { ReputationService } from './reputation.service';

/**
 * Periodically computes fresh reputation snapshots for active contributors.
 * Ensures contributor profiles and leaderboards stay up to date even if
 * events are missed (#589).
 */
@Injectable()
export class ReputationScheduler {
  private readonly logger = new Logger(ReputationScheduler.name);

  constructor(
    private readonly reputationService: ReputationService,
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sweepActiveContributors(): Promise<void> {
    try {
      const bountyUsers = await this.bountyRepo
        .createQueryBuilder('b')
        .select('DISTINCT b.claimedById', 'userId')
        .where('b.claimedById IS NOT NULL')
        .getRawMany<{ userId: string }>();

      const paymentUsers = await this.paymentRepo
        .createQueryBuilder('p')
        .select('DISTINCT p.recipientId', 'userId')
        .where('p.recipientId IS NOT NULL')
        .getRawMany<{ userId: string }>();

      const uniqueUserIds = new Set<string>([
        ...bountyUsers.map((u) => u.userId),
        ...paymentUsers.map((u) => u.userId),
      ]);

      for (const userId of uniqueUserIds) {
        await this.reputationService.computeAndSave(userId).catch((err) => {
          this.logger.warn(
            `Failed nightly reputation recompute for user ${userId}: ${(err as Error).message}`,
          );
        });
      }
      if (uniqueUserIds.size > 0) {
        this.logger.log(
          `Nightly reputation sweep completed for ${uniqueUserIds.size} contributors`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Nightly reputation sweep failed: ${(err as Error).message}`,
      );
    }
  }
}
