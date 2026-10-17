import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, Payment, ReputationSnapshot } from '../common/entities';
import { queryContributorCoreStats } from '../common/stats/contributor-stats.sql';

export const REPUTATION_HISTORY_DEFAULT_LIMIT = 50;
export const REPUTATION_HISTORY_MAX_LIMIT = 100;

export interface ReputationHistoryOptions {
  limit?: number;
  offset?: number;
}

@Injectable()
export class ReputationService {
  constructor(
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(ReputationSnapshot)
    private readonly snapshotRepo: Repository<ReputationSnapshot>,
  ) {}

  /**
   * Recomputes a contributor's reputation stats from SQL aggregates of their
   * bounty activity and appends a new snapshot row.
   */
  async computeAndSave(userId: string): Promise<ReputationSnapshot> {
    const stats = await queryContributorCoreStats(
      this.bountyRepo,
      userId,
      this.paymentRepo,
    );

    const fields = {
      userId,
      totalEarnings: stats.lifetimeEarnings.toFixed(7),
      mergedPrCount: stats.mergedCount,
      openBountiesClaimed: stats.openBountiesClaimed,
      completionRate: stats.completionRate.toFixed(2),
      avgReviewTimeHours: stats.avgReviewTimeHours.toFixed(2),
      onTimeDeliveryPercentage: stats.onTimeDeliveryPercentage.toFixed(2),
      languages: stats.languages,
      orgsContributedTo: stats.orgs,
    };

    // Skip the insert when nothing changed — an unthrottled recompute could
    // otherwise append a row per call (~170k/day for one user, #584). If the
    // stats match the latest snapshot, return it instead of a duplicate.
    const latest = await this.snapshotRepo.findOne({
      where: { userId },
      order: { computedAt: 'DESC' },
    });
    if (
      latest &&
      latest.totalEarnings === fields.totalEarnings &&
      latest.mergedPrCount === fields.mergedPrCount &&
      latest.openBountiesClaimed === fields.openBountiesClaimed &&
      latest.completionRate === fields.completionRate &&
      latest.avgReviewTimeHours === fields.avgReviewTimeHours &&
      latest.onTimeDeliveryPercentage === fields.onTimeDeliveryPercentage
    ) {
      return latest;
    }

    return this.snapshotRepo.save(this.snapshotRepo.create(fields));
  }

  async getLatest(userId: string): Promise<ReputationSnapshot | null> {
    return this.snapshotRepo.findOne({
      where: { userId },
      order: { computedAt: 'DESC' },
    });
  }

  async history(
    userId: string,
    options: ReputationHistoryOptions = {},
  ): Promise<ReputationSnapshot[]> {
    const limit = Math.min(
      Math.max(options.limit ?? REPUTATION_HISTORY_DEFAULT_LIMIT, 1),
      REPUTATION_HISTORY_MAX_LIMIT,
    );
    const offset = Math.max(options.offset ?? 0, 0);
    return this.snapshotRepo.find({
      where: { userId },
      order: { computedAt: 'ASC' },
      take: limit,
      skip: offset,
    });
  }
}
