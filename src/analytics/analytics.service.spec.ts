import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { Bounty, Issue, Repository as RepositoryEntity } from '../common/entities';
import { BountyStatus } from '../common/enums';
import * as statsUtil from '../common/stats/contributor-stats.util';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  const mockBountyRepo = {
    find: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockIssueRepo = {
    find: jest.fn(),
  };

  const mockRepositoryRepo = {
    count: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(Bounty), useValue: mockBountyRepo },
        { provide: getRepositoryToken(Issue), useValue: mockIssueRepo },
        { provide: getRepositoryToken(RepositoryEntity), useValue: mockRepositoryRepo },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should handle empty input correctly (zero bounties)', async () => {
    mockBountyRepo.find.mockResolvedValue([]);
    jest.spyOn(statsUtil, 'computeContributorStats').mockReturnValue({
      mergedCount: 0,
      completionRate: 0,
      avgReviewTimeHours: 0,
      languages: {},
      orgs: [],
    });

    const result = await service.forContributor('user-1');
    expect(result.lifetimeEarnings).toBe(0);
    expect(result.repoCount).toBe(0);
    expect(result.orgCount).toBe(0);
    expect(result.mergeRate).toBe(0);
    expect(result.avgReviewTimeHours).toBe(0);
    expect(result.heatmap).toEqual([]);
    expect(result.topClients).toEqual([]);
  });

  it('should compute heatmap date-bucketing and merge-rate correctly', async () => {
    mockBountyRepo.find.mockResolvedValue([
      { id: 'b1', issueId: 'i1', amount: '100', status: BountyStatus.PAID, paidAt: new Date('2023-01-01T10:00:00Z'), sponsorId: 'client-A' },
      { id: 'b2', issueId: 'i2', amount: '200', status: BountyStatus.PAID, paidAt: new Date('2023-01-01T15:00:00Z'), sponsorId: 'client-B' },
      { id: 'b3', issueId: 'i3', amount: '50', status: BountyStatus.PAID, paidAt: new Date('2023-01-02T10:00:00Z'), sponsorId: 'client-A' },
    ]);
    mockIssueRepo.find.mockResolvedValue([
      { id: 'i1', repositoryId: 'r1' },
      { id: 'i2', repositoryId: 'r2' },
      { id: 'i3', repositoryId: 'r1' },
    ]);
    jest.spyOn(statsUtil, 'computeContributorStats').mockReturnValue({
      mergedCount: 3,
      completionRate: 100,
      avgReviewTimeHours: 2,
      languages: { TypeScript: 3 },
      orgs: ['org1'],
    });

    const result = await service.forContributor('user-1');
    expect(result.mergeRate).toBe(100);
    expect(result.heatmap).toEqual([
      { date: '2023-01-01', count: 2 },
      { date: '2023-01-02', count: 1 },
    ]);
    // Sorted by total paid (B=200, A=150)
    expect(result.topClients).toEqual([
      { sponsorId: 'client-B', totalPaid: 200 },
      { sponsorId: 'client-A', totalPaid: 150 },
    ]);
  });
});
