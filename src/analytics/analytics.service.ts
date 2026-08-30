import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Bounty,
  Issue,
  Repository as RepositoryEntity,
} from '../common/entities';
import { BountyStatus } from '../common/enums';
import { computeContributorStats } from '../common/stats/contributor-stats.util';

export interface ContributorAnalytics {
  lifetimeEarnings: number;
  repoCount: number;
  orgCount: number;
  mergeRate: number;
  avgReviewTimeHours: number;
  languages: Record<string, number>;
  heatmap: Array<{ date: string; count: number }>;
  topClients: Array<{ sponsorId: string; totalPaid: number }>;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(Issue) private readonly issueRepo: Repository<Issue>,
    @InjectRepository(RepositoryEntity)
    private readonly repositoryRepo: Repository<RepositoryEntity>,
  ) {}

  async forContributor(userId: string): Promise<ContributorAnalytics> {
    const claimed = await this.bountyRepo.find({
      where: { claimedById: userId },
    });
    const paid = claimed.filter((b) => b.status === BountyStatus.PAID);

    const issues = claimed.length
      ? await this.issueRepo.find({
          where: claimed.map((b) => ({ id: b.issueId })),
          relations: { repository: true },
        })
      : [];

    const stats = computeContributorStats(claimed, issues);

    const lifetimeEarnings = paid.reduce((sum, b) => sum + Number(b.amount), 0);
    const repoIds = new Set(issues.map((i) => i.repositoryId));

    const heatmapMap = new Map<string, number>();
    for (const bounty of paid) {
      if (!bounty.paidAt) continue;
      const day = bounty.paidAt.toISOString().slice(0, 10);
      heatmapMap.set(day, (heatmapMap.get(day) ?? 0) + 1);
    }
    const heatmap = [...heatmapMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    const clientTotals = new Map<string, number>();
    for (const bounty of paid) {
      if (!bounty.sponsorId) continue;
      clientTotals.set(
        bounty.sponsorId,
        (clientTotals.get(bounty.sponsorId) ?? 0) + Number(bounty.amount),
      );
    }
    const topClients = [...clientTotals.entries()]
      .map(([sponsorId, totalPaid]) => ({ sponsorId, totalPaid }))
      .sort((a, b) => b.totalPaid - a.totalPaid)
      .slice(0, 10);

    return {
      lifetimeEarnings,
      repoCount: repoIds.size,
      orgCount: stats.orgs.length,
      mergeRate: stats.completionRate,
      avgReviewTimeHours: stats.avgReviewTimeHours,
      languages: stats.languages,
      heatmap,
      topClients,
    };
  }

  /** Platform-wide stats for the homepage / admin view. */
  async platformSummary() {
    const [totalBounties, totalPaidRaw, totalRepos] = await Promise.all([
      this.bountyRepo.count(),
      this.bountyRepo
        .createQueryBuilder('bounty')
        .select('COALESCE(SUM(bounty.amount), 0)', 'total')
        .where('bounty.status = :status', { status: BountyStatus.PAID })
        .getRawOne<{ total: string }>(),
      this.repositoryRepo.count(),
    ]);

    return {
      totalBounties,
      totalPaidOut: Number(totalPaidRaw?.total ?? 0),
      totalRepos,
    };
  }
}
