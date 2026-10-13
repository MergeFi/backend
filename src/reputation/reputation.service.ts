import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, Payment, ReputationSnapshot } from '../common/entities';
import { queryContributorCoreStats } from '../common/stats/contributor-stats.sql';
import {
  REPUTATION_RECOMPUTE_EVENT,
  ReputationRecomputePayload,
} from './reputation.events';

export const REPUTATION_HISTORY_DEFAULT_LIMIT = 50;
export const REPUTATION_HISTORY_MAX_LIMIT = 100;

export interface ReputationHistoryOptions {
  limit?: number;
  offset?: number;
}

@Injectable()
export class ReputationService {
  private readonly logger = new Logger(ReputationService.name);

  constructor(
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(ReputationSnapshot)
    private readonly snapshotRepo: Repository<ReputationSnapshot>,
  ) {}

  /**
   * Asynchronously handles automated reputation recalculation on payment and payout events (#589).
   */
  @OnEvent(REPUTATION_RECOMPUTE_EVENT, { async: true })
  async handleRecomputeEvent(
    payload: ReputationRecomputePayload,
  ): Promise<void> {
    if (!payload?.userId) return;
    try {
      await this.computeAndSave(payload.userId);
    } catch (err) {
      this.logger.error(
        `Failed to recompute reputation snapshot for user ${payload.userId}: ${(err as Error).message}`,
      );
    }
  }

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

  /**
   * Retrieves the most recent snapshot for the user, computing and saving an
   * initial snapshot if none exists yet so profiles and dashboards never read empty (#589).
   */
  async getOrComputeLatest(userId: string): Promise<ReputationSnapshot> {
    const latest = await this.getLatest(userId);
    if (latest) {
      return latest;
    }
    return this.computeAndSave(userId);
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
