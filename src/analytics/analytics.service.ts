import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Bounty,
  Payment,
  Repository as RepositoryEntity,
} from '../common/entities';
import { BountyStatus } from '../common/enums';
import {
  heatmapRange,
  queryContributorCoreStats,
  queryPayoutHeatmap,
  queryTopClients,
} from '../common/stats/contributor-stats.sql';

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

export interface ContributorAnalyticsQuery {
  from?: string;
  to?: string;
}

export interface PlatformSummary {
  totalBounties: number;
  totalPaidOut: number;
  totalRepos: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(RepositoryEntity)
    private readonly repositoryRepo: Repository<RepositoryEntity>,
  ) {}

  async forContributor(
    userId: string,
    query: ContributorAnalyticsQuery = {},
  ): Promise<ContributorAnalytics> {
    const range = heatmapRange(query.from, query.to);
    const [stats, heatmap, topClients] = await Promise.all([
      queryContributorCoreStats(this.bountyRepo, userId, this.paymentRepo),
      queryPayoutHeatmap(this.bountyRepo, userId, range, this.paymentRepo),
      queryTopClients(this.bountyRepo, userId, this.paymentRepo),
    ]);

    return {
      lifetimeEarnings: stats.lifetimeEarnings,
      repoCount: stats.repoCount,
      orgCount: stats.orgCount,
      mergeRate: stats.completionRate,
      avgReviewTimeHours: stats.avgReviewTimeHours,
      languages: stats.languages,
      heatmap,
      topClients,
    };
  }

  /**
   * Platform-wide stats for the homepage. Not cached here: an in-process cache
   * gives each replica different figures and invalidation reaches only one of
   * them (#788). The controller sets a shared-cache header instead, so one copy
   * is held at the CDN.
   */
  async platformSummary(): Promise<PlatformSummary> {
    return this.loadPlatformSummary();
  }

  private async loadPlatformSummary(): Promise<PlatformSummary> {
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
