import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReputationService } from './reputation.service';
import { Bounty, ReputationSnapshot } from '../common/entities';
import * as sql from '../common/stats/contributor-stats.sql';

jest.mock('../common/stats/contributor-stats.sql', () => ({
  queryContributorCoreStats: jest.fn(),
}));

const mockedSql = sql as jest.Mocked<typeof sql>;

describe('ReputationService', () => {
  let service: ReputationService;

  const mockBountyRepo = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockSnapshotRepo = {
    create: jest.fn((dto: Record<string, unknown>) => dto),
    save: jest.fn((entity) => Promise.resolve({ id: 'snap-1', ...entity })),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReputationService,
        { provide: getRepositoryToken(Bounty), useValue: mockBountyRepo },
        {
          provide: getRepositoryToken(ReputationSnapshot),
          useValue: mockSnapshotRepo,
        },
      ],
    }).compile();

    service = module.get<ReputationService>(ReputationService);
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

    const result = await service.computeAndSave('user-1');
    expect(result.totalEarnings).toBe('0.0000000');
    expect(result.mergedPrCount).toBe(0);
    expect(result.openBountiesClaimed).toBe(0);
    expect(result.completionRate).toBe('0.00');
    expect(result.onTimeDeliveryPercentage).toBe('0.00');
    expect(mockBountyRepo.find).not.toHaveBeenCalled();
  });

  it('should compute completion-rate and on-time-delivery math correctly', async () => {
    mockedSql.queryContributorCoreStats.mockResolvedValue({
      claimedCount: 3,
      mergedCount: 2,
      completionRate: (2 / 3) * 100,
      avgReviewTimeHours: 2.5,
      lifetimeEarnings: 100,
      openBountiesClaimed: 1,
      onTimeCount: 1,
      onTimeDeliveryPercentage: 50,
      repoCount: 0,
      orgCount: 0,
      languages: {},
      orgs: [],
    });

    const result = await service.computeAndSave('user-1');
    expect(result.totalEarnings).toBe('100.0000000');
    expect(result.openBountiesClaimed).toBe(1);
    expect(result.completionRate).toBe('66.67');
    expect(result.onTimeDeliveryPercentage).toBe('50.00');
  });

  it('paginates history with a default/max limit', async () => {
    mockSnapshotRepo.find.mockResolvedValue([]);
    await service.history('user-1');
    expect(mockSnapshotRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, skip: 0 }),
    );

    await service.history('user-1', { limit: 1000, offset: 10 });
    expect(mockSnapshotRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, skip: 10 }),
    );
  });
});
