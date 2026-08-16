import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BountiesService } from './bounties.service';
import { EscrowService } from '../escrow/escrow.service';
import { Bounty, Team, User } from '../common/entities';
import { AssetType, BountyDifficulty, BountyStatus } from '../common/enums';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../common/dto/pagination.dto';

describe('BountiesService list pagination', () => {
  let service: BountiesService;
  let bountyRepo: { findAndCount: jest.Mock };

  beforeEach(async () => {
    bountyRepo = {
      findAndCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BountiesService,
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: getRepositoryToken(User), useValue: {} },
        { provide: getRepositoryToken(Team), useValue: {} },
        { provide: EscrowService, useValue: {} },
      ],
    }).compile();

    service = module.get(BountiesService);
  });

  it('defaults limit to DEFAULT_PAGE_LIMIT (20) and offset to 0', async () => {
    const fakeBounties = Array.from({ length: 20 }, (_, i) => ({
      id: `bounty-${i}`,
      status: BountyStatus.OPEN,
    })) as Bounty[];

    bountyRepo.findAndCount.mockResolvedValue([fakeBounties, 45]);

    const result = await service.list();

    expect(bountyRepo.findAndCount).toHaveBeenCalledWith({
      where: {},
      take: DEFAULT_PAGE_LIMIT,
      skip: 0,
      order: { createdAt: 'DESC' },
    });

    expect(result.data.length).toBe(20);
    expect(result.total).toBe(45);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.hasMore).toBe(true);
  });

  it('enforces MAX_PAGE_LIMIT when caller passes a higher limit', async () => {
    bountyRepo.findAndCount.mockResolvedValue([[], 0]);

    await service.list({ limit: 5000, offset: 10 });

    expect(bountyRepo.findAndCount).toHaveBeenCalledWith({
      where: {},
      take: MAX_PAGE_LIMIT,
      skip: 10,
      order: { createdAt: 'DESC' },
    });
  });

  it('filters by status when provided in query', async () => {
    bountyRepo.findAndCount.mockResolvedValue([[], 0]);

    await service.list({ status: BountyStatus.FUNDED, limit: 10, offset: 5 });

    expect(bountyRepo.findAndCount).toHaveBeenCalledWith({
      where: { status: BountyStatus.FUNDED },
      take: 10,
      skip: 5,
      order: { createdAt: 'DESC' },
    });
  });

  it('correctly calculates hasMore = false when at end of list', async () => {
    const fakeBounties = Array.from({ length: 5 }, (_, i) => ({
      id: `bounty-${i}`,
      status: BountyStatus.OPEN,
    })) as Bounty[];

    bountyRepo.findAndCount.mockResolvedValue([fakeBounties, 25]);

    const result = await service.list({ limit: 20, offset: 20 });

    expect(result.hasMore).toBe(false);
    expect(result.total).toBe(25);
  });
});
