import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, Issue, ReputationSnapshot } from '../common/entities';
import { BountyStatus } from '../common/enums';
import { computeContributorStats } from '../common/stats/contributor-stats.util';

@Injectable()
export class ReputationService {
  constructor(
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(Issue) private readonly issueRepo: Repository<Issue>,
    @InjectRepository(ReputationSnapshot)
    private readonly snapshotRepo: Repository<ReputationSnapshot>,
  ) {}

  /**
   * Recomputes a contributor's reputation stats from their historical bounty
   * activity and appends a new snapshot row.
   */
  async computeAndSave(userId: string): Promise<ReputationSnapshot> {
    const claimedBounties = await this.bountyRepo.find({
      where: { claimedById: userId },
    });
    const issues = claimedBounties.length
      ? await this.issueRepo.find({
          where: claimedBounties.map((b) => ({ id: b.issueId })),
          relations: { repository: true },
        })
      : [];

    const stats = computeContributorStats(claimedBounties, issues);

    const merged = claimedBounties.filter((b) =>
      [BountyStatus.MERGED, BountyStatus.PAID].includes(b.status),
    );
    const paid = claimedBounties.filter((b) => b.status === BountyStatus.PAID);
    const totalEarnings = paid.reduce((sum, b) => sum + Number(b.amount), 0);

    const onTime = merged.filter(
      (b) => !b.deadline || (b.mergedAt && b.mergedAt <= b.deadline),
    );
    const onTimeDeliveryPercentage =
      merged.length > 0 ? (onTime.length / merged.length) * 100 : 0;

    const snapshot = this.snapshotRepo.create({
      userId,
      totalEarnings: totalEarnings.toFixed(7),
      mergedPrCount: stats.mergedCount,
      openBountiesClaimed: claimedBounties.filter((b) =>
        [BountyStatus.CLAIMED, BountyStatus.IN_REVIEW].includes(b.status),
      ).length,
      completionRate: stats.completionRate.toFixed(2),
      avgReviewTimeHours: stats.avgReviewTimeHours.toFixed(2),
      onTimeDeliveryPercentage: onTimeDeliveryPercentage.toFixed(2),
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

  async history(userId: string): Promise<ReputationSnapshot[]> {
    return this.snapshotRepo.find({
      where: { userId },
      order: { computedAt: 'ASC' },
    });
  }
}
