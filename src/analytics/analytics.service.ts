import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Bounty,
  Payment,
  Repository as RepositoryEntity,
} from '../common/entities';
import { AssetType, BountyStatus, PaymentStatus } from '../common/enums';
import { AppConfig } from '../config/configuration';
import {
  heatmapRange,
  queryContributorCoreStats,
  queryPayoutHeatmap,
  queryTopClients,
} from '../common/stats/contributor-stats.sql';
import { ANALYTICS_PLATFORM_INVALIDATE_EVENT } from './analytics.events';
import { TtlCache } from './ttl-cache';

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
  paidOutByAsset: Record<AssetType, number>;
  totalRepos: number;
}

@Injectable()
export class AnalyticsService {
  private readonly platformCache: TtlCache<PlatformSummary>;

  constructor(
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(RepositoryEntity)
    private readonly repositoryRepo: Repository<RepositoryEntity>,
    configService: ConfigService<AppConfig, true>,
  ) {
    const ttlMs = configService.get('analytics', {
      infer: true,
    }).platformSummaryTtlMs;
    this.platformCache = new TtlCache<PlatformSummary>(ttlMs);
  }

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
   * Platform-wide stats for the homepage. Cached in-process with a TTL
   * (ANALYTICS_PLATFORM_SUMMARY_TTL_MS, default 60s) and busted on bounty
   * create/pay and new repository insert. Concurrent misses share one query.
   */
  async platformSummary(): Promise<PlatformSummary> {
    return this.platformCache.getOrLoad(() => this.loadPlatformSummary());
  }

  @OnEvent(ANALYTICS_PLATFORM_INVALIDATE_EVENT)
  invalidatePlatformSummary(): void {
    this.platformCache.invalidate();
  }

  private async loadPlatformSummary(): Promise<PlatformSummary> {
    const [totalBounties, paymentRows, totalRepos] = await Promise.all([
      this.bountyRepo.count(),
      this.paymentRepo
        .createQueryBuilder('payment')
        .select('payment.asset', 'asset')
        .addSelect('COALESCE(SUM(payment.amount), 0)', 'total')
        .where('payment.status = :status', { status: PaymentStatus.CONFIRMED })
        .groupBy('payment.asset')
        .getRawMany<{ asset: AssetType; total: string }>(),
      this.repositoryRepo.count(),
    ]);

    const paidOutByAsset: Record<AssetType, number> = {
      [AssetType.USDC]: 0,
      [AssetType.XLM]: 0,
    };

    for (const row of paymentRows) {
      if (row.asset && row.asset in paidOutByAsset) {
        paidOutByAsset[row.asset] = Number(row.total);
      }
    }

    return {
      totalBounties,
      totalPaidOut: paidOutByAsset[AssetType.USDC],
      paidOutByAsset,
      totalRepos,
    };
  }
}
