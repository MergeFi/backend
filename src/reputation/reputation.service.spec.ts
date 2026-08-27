import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReputationService } from './reputation.service';
import { Bounty, Issue, ReputationSnapshot } from '../common/entities';
import { BountyStatus } from '../common/enums';
import * as statsUtil from '../common/stats/contributor-stats.util';

describe('ReputationService', () => {
  let service: ReputationService;

  const mockBountyRepo = {
    find: jest.fn(),
  };

  const mockIssueRepo = {
    find: jest.fn(),
  };

  const mockSnapshotRepo = {
    create: jest.fn((dto) => dto),
    save: jest.fn((entity) => Promise.resolve({ id: 'snap-1', ...entity })),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReputationService,
        { provide: getRepositoryToken(Bounty), useValue: mockBountyRepo },
        { provide: getRepositoryToken(Issue), useValue: mockIssueRepo },
        { provide: getRepositoryToken(ReputationSnapshot), useValue: mockSnapshotRepo },
      ],
    }).compile();

    service = module.get<ReputationService>(ReputationService);
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

    const result = await service.computeAndSave('user-1');
    expect(result.totalEarnings).toBe('0.0000000');
    expect(result.mergedPrCount).toBe(0);
    expect(result.openBountiesClaimed).toBe(0);
    expect(result.completionRate).toBe('0.00');
    expect(result.onTimeDeliveryPercentage).toBe('0.00');
  });

  it('should compute completion-rate and on-time-delivery math correctly', async () => {
    mockBountyRepo.find.mockResolvedValue([
      { status: BountyStatus.PAID, amount: '100', deadline: new Date('2023-01-02'), mergedAt: new Date('2023-01-01') },
      { status: BountyStatus.MERGED, amount: '0', deadline: new Date('2023-01-01'), mergedAt: new Date('2023-01-02') }, // Late
      { status: BountyStatus.CLAIMED, amount: '50' },
    ]);
    mockIssueRepo.find.mockResolvedValue([]);
    jest.spyOn(statsUtil, 'computeContributorStats').mockReturnValue({
      mergedCount: 2,
      completionRate: 66.67,
      avgReviewTimeHours: 2.5,
      languages: {},
      orgs: [],
    });

    const result = await service.computeAndSave('user-1');
    expect(result.totalEarnings).toBe('100.0000000'); // only PAID
    expect(result.openBountiesClaimed).toBe(1); // CLAIMED
    expect(result.completionRate).toBe('66.67');
    expect(result.onTimeDeliveryPercentage).toBe('50.00'); // 1 on-time out of 2 merged
  });
});
