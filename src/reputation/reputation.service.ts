import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, ReputationSnapshot } from '../common/entities';
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
    @InjectRepository(ReputationSnapshot)
    private readonly snapshotRepo: Repository<ReputationSnapshot>,
  ) {}

  /**
   * Recomputes a contributor's reputation stats from SQL aggregates of their
   * bounty activity and appends a new snapshot row.
   */
  async computeAndSave(userId: string): Promise<ReputationSnapshot> {
    const stats = await queryContributorCoreStats(this.bountyRepo, userId);

    const snapshot = this.snapshotRepo.create({
      userId,
      totalEarnings: stats.lifetimeEarnings.toFixed(7),
      mergedPrCount: stats.mergedCount,
      openBountiesClaimed: stats.openBountiesClaimed,
      completionRate: stats.completionRate.toFixed(2),
      avgReviewTimeHours: stats.avgReviewTimeHours.toFixed(2),
      onTimeDeliveryPercentage: stats.onTimeDeliveryPercentage.toFixed(2),
      languages: stats.languages,
      orgsContributedTo: stats.orgs,
    });
    return this.snapshotRepo.save(snapshot);
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
