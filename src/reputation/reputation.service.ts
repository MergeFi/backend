import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, Issue, ReputationSnapshot } from '../common/entities';
import { BountyStatus } from '../common/enums';

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
    const merged = claimedBounties.filter((b) =>
      [BountyStatus.MERGED, BountyStatus.PAID].includes(b.status),
    );
    const paid = claimedBounties.filter((b) => b.status === BountyStatus.PAID);

    const totalEarnings = paid.reduce((sum, b) => sum + Number(b.amount), 0);
    const completionRate =
      claimedBounties.length > 0
        ? (merged.length / claimedBounties.length) * 100
        : 0;

    const reviewTimes = merged
      .filter((b) => b.claimedAt && b.mergedAt)
      .map((b) => (b.mergedAt!.getTime() - b.claimedAt!.getTime()) / 3_600_000);
    const avgReviewTimeHours =
      reviewTimes.length > 0
        ? reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length
        : 0;

    const onTime = merged.filter(
      (b) => !b.deadline || (b.mergedAt && b.mergedAt <= b.deadline),
    );
    const onTimeDeliveryPercentage =
      merged.length > 0 ? (onTime.length / merged.length) * 100 : 0;

    const issueIds = claimedBounties.map((b) => b.issueId);
    const issues = issueIds.length
      ? await this.issueRepo.find({
          where: issueIds.map((id) => ({ id })),
          relations: { repository: true },
        })
      : [];
    const orgsContributedTo = [
      ...new Set(issues.map((i) => i.repository?.owner).filter(Boolean)),
    ];
    const languages = issues.reduce<Record<string, number>>((acc, issue) => {
      const lang = issue.repository?.primaryLanguage;
      if (lang) acc[lang] = (acc[lang] ?? 0) + 1;
      return acc;
    }, {});

    const snapshot = this.snapshotRepo.create({
      userId,
      totalEarnings: totalEarnings.toFixed(7),
      mergedPrCount: merged.length,
      openBountiesClaimed: claimedBounties.filter((b) =>
        [BountyStatus.CLAIMED, BountyStatus.IN_REVIEW].includes(b.status),
      ).length,
      completionRate: completionRate.toFixed(2),
      avgReviewTimeHours: avgReviewTimeHours.toFixed(2),
      onTimeDeliveryPercentage: onTimeDeliveryPercentage.toFixed(2),
      languages,
      orgsContributedTo,
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
