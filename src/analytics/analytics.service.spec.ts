import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import {
  Bounty,
  Payment,
  Repository as RepositoryEntity,
} from '../common/entities';
import * as sql from '../common/stats/contributor-stats.sql';
import { heatmapRange } from '../common/stats/contributor-stats.sql';
import { TtlCache } from './ttl-cache';

jest.mock('../common/stats/contributor-stats.sql', () => {
  return {
    ...jest.requireActual<
      typeof import('../common/stats/contributor-stats.sql')
    >('../common/stats/contributor-stats.sql'),
    queryContributorCoreStats: jest.fn(),
    queryPayoutHeatmap: jest.fn(),
    queryTopClients: jest.fn(),
  };
});

const mockedSql = sql as jest.Mocked<typeof sql>;

describe('heatmapRange', () => {
  it('rejects an inverted from/to window', () => {
    expect(() => heatmapRange('2023-02-01', '2023-01-01')).toThrow(
      BadRequestException,
    );
  });

  it(`rejects a span longer than ${sql.HEATMAP_MAX_DAYS} days`, () => {
    expect(() => heatmapRange('2020-01-01', '2022-01-02')).toThrow(
      BadRequestException,
    );
  });
});

describe('TtlCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the cached value until TTL elapses', async () => {
    const cache = new TtlCache<number>(1_000);
    const loader = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.getOrLoad(loader)).toBe(1);
    expect(await cache.getOrLoad(loader)).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1_001);
    expect(await cache.getOrLoad(loader)).toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent misses onto one loader call', async () => {
    const cache = new TtlCache<string>(60_000);
    let resolveLoad!: (value: string) => void;
    const loader = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const a = cache.getOrLoad(loader);
    const b = cache.getOrLoad(loader);
    resolveLoad('shared');
    expect(await Promise.all([a, b])).toEqual(['shared', 'shared']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('invalidate drops the cached entry', async () => {
    const cache = new TtlCache<number>(60_000);
    const loader = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await cache.getOrLoad(loader);
    cache.invalidate();
    expect(await cache.getOrLoad(loader)).toBe(2);
  });
});

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  const mockBountyRepo = {
    find: jest.fn(),
    count: jest.fn(),
  };
  const mockPaymentRepo = {
    createQueryBuilder: jest.fn(),
  };
  const mockRepositoryRepo = {
    count: jest.fn(),
  };
  const mockPaymentRepo = {
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(Bounty), useValue: mockBountyRepo },
        { provide: getRepositoryToken(Payment), useValue: mockPaymentRepo },
        {
          provide: getRepositoryToken(RepositoryEntity),
          useValue: mockRepositoryRepo,
        },
        {
          provide: ConfigService,
          useValue: {
            get: () => ({ platformSummaryTtlMs: 60_000 }),
          },
        },
      ],
    }).compile();

    service = module.get(AnalyticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should handle empty input correctly (zero bounties)', async () => {
    mockedSql.queryContributorCoreStats.mockResolvedValue({
      claimedCount: 0,
      mergedCount: 0,
      completionRate: 0,
      avgReviewTimeHours: 0,
      lifetimeEarnings: 0,
      openBountiesClaimed: 0,
      onTimeCount: 0,
      onTimeDeliveryPercentage: 0,
      repoCount: 0,
      orgCount: 0,
      languages: {},
      orgs: [],
    });
    mockedSql.queryPayoutHeatmap.mockResolvedValue([]);
    mockedSql.queryTopClients.mockResolvedValue([]);

    const result = await service.forContributor(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(result.lifetimeEarnings).toBe(0);
    expect(result.repoCount).toBe(0);
    expect(result.orgCount).toBe(0);
    expect(result.mergeRate).toBe(0);
    expect(result.avgReviewTimeHours).toBe(0);
    expect(result.heatmap).toEqual([]);
    expect(result.topClients).toEqual([]);
    expect(mockBountyRepo.find).not.toHaveBeenCalled();
  });

  it('should compute heatmap date-bucketing and merge-rate correctly', async () => {
    mockedSql.queryContributorCoreStats.mockResolvedValue({
      claimedCount: 3,
      mergedCount: 3,
      completionRate: 100,
      avgReviewTimeHours: 2,
      lifetimeEarnings: 350,
      openBountiesClaimed: 0,
      onTimeCount: 3,
      onTimeDeliveryPercentage: 100,
      repoCount: 2,
      orgCount: 1,
      languages: { TypeScript: 3 },
      orgs: ['org1'],
    });
    mockedSql.queryPayoutHeatmap.mockResolvedValue([
      { date: '2023-01-01', count: 2 },
      { date: '2023-01-02', count: 1 },
    ]);
    mockedSql.queryTopClients.mockResolvedValue([
      { sponsorId: 'client-B', totalPaid: 200 },
      { sponsorId: 'client-A', totalPaid: 150 },
    ]);

    const result = await service.forContributor(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(result.mergeRate).toBe(100);
    expect(result.heatmap).toEqual([
      { date: '2023-01-01', count: 2 },
      { date: '2023-01-02', count: 1 },
    ]);
    expect(result.topClients).toEqual([
      { sponsorId: 'client-B', totalPaid: 200 },
      { sponsorId: 'client-A', totalPaid: 150 },
    ]);
  });

  it('sums confirmed payments per asset and keeps XLM out of the USDC headline (#787)', async () => {
    mockBountyRepo.count.mockResolvedValue(4);
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { asset: 'USDC', total: '10' },
        { asset: 'XLM', total: '500' },
      ]),
    };
    mockPaymentRepo.createQueryBuilder.mockReturnValue(qb);
    mockRepositoryRepo.count.mockResolvedValue(2);

    const summary = await service.platformSummary();

    expect(qb.where).toHaveBeenCalledWith('payment.status = :status', {
      status: 'confirmed',
    });
    expect(qb.groupBy).toHaveBeenCalledWith('payment.asset');
    expect(summary.totalPaidOut).toBe(10);
    expect(summary.paidOutByAsset).toEqual({ USDC: 10, XLM: 500 });
  });

  it('reports totalPaidOut as 0 when there are no USDC payments', async () => {
    mockBountyRepo.count.mockResolvedValue(0);
    mockPaymentRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    });
    mockRepositoryRepo.count.mockResolvedValue(0);

    const summary = await service.platformSummary();

    expect(summary.totalPaidOut).toBe(0);
    expect(summary.paidOutByAsset).toEqual({});
  });

  it('serves platformSummary from cache until invalidate', async () => {
    mockBountyRepo.count.mockResolvedValue(4);
    const queryBuilder = {
    mockPaymentRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '10' }),
    };
    mockPaymentRepo.createQueryBuilder.mockReturnValue(queryBuilder);
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ asset: 'USDC', total: '10' }]),
    });
    mockRepositoryRepo.count.mockResolvedValue(2);

    const first = await service.platformSummary();
    const second = await service.platformSummary();
    expect(first).toEqual({
      totalBounties: 4,
      totalPaidOut: 10,
      paidOutByAsset: { USDC: 10 },
      totalRepos: 2,
    });
    expect(second).toEqual(first);
    expect(mockBountyRepo.count).toHaveBeenCalledTimes(1);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'payment.status = :status',
      { status: 'confirmed' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'payment.isProtocolFee = false',
    );

    service.invalidatePlatformSummary();
    mockBountyRepo.count.mockResolvedValue(5);
    const third = await service.platformSummary();
    expect(third.totalBounties).toBe(5);
    expect(mockBountyRepo.count).toHaveBeenCalledTimes(2);
  });
});
