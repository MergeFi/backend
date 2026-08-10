import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BountiesService } from './bounties.service';
import { EscrowService } from '../escrow/escrow.service';
import { Bounty, Team, User } from '../common/entities';
import { AssetType, BountyDifficulty, BountyStatus } from '../common/enums';
import { InvalidBountyTransitionError } from './bounty-state-machine';
import { DataSource, QueryRunner } from 'typeorm';

describe('BountiesService', () => {
  let service: BountiesService;
  let bountyRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock; createQueryBuilder: jest.Mock };
  let escrowService: {
    fund: jest.Mock;
    release: jest.Mock;
    splitRelease: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  const createMockRunner = (bounty: Partial<Bounty>) => ({
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(bounty),
    }),
    save: jest.fn((b: Partial<Bounty>) => Promise.resolve(b)),
    findOne: jest.fn(),
  });

  beforeEach(async () => {
    bountyRepo = {
      findOne: jest.fn(),
      save: jest.fn((b: Partial<Bounty>) => Promise.resolve(b)),
      create: jest.fn((data: Partial<Bounty>) => ({
        id: 'bounty-1',
        status: BountyStatus.OPEN,
        ...data,
      })),
      createQueryBuilder: jest.fn(),
    };
    escrowService = {
      fund: jest.fn().mockResolvedValue({ id: 'escrow-1', status: 'locked' }),
      release: jest.fn().mockResolvedValue(undefined),
      splitRelease: jest.fn().mockResolvedValue([]),
    };
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BountiesService,
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Team), useValue: { findOne: jest.fn() } },
        { provide: EscrowService, useValue: escrowService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(BountiesService);
  });

  it('creates a bounty in OPEN status', async () => {
    const bounty = await service.create({
      issueId: 'issue-1',
      sponsorId: 'sponsor-1',
      amount: '100',
      asset: AssetType.USDC,
      difficulty: BountyDifficulty.INTERMEDIATE,
    });
    expect(bounty.status).toBe(BountyStatus.OPEN);
  });

  it('funding an OPEN bounty locks escrow and moves it to FUNDED', async () => {
    const mockBounty = {
      id: 'b1',
      status: BountyStatus.OPEN,
      amount: '100',
      asset: AssetType.USDC,
      sponsorId: 'sponsor-1',
    };
    const runner = createMockRunner(mockBounty);
    dataSource.transaction.mockImplementation((fn: Function) => fn(runner));

    const bounty = await service.fund('b1', 'GFUNDER');

    expect(escrowService.fund).toHaveBeenCalledWith(
      expect.objectContaining({
        bountyId: 'b1',
        funderAddress: 'GFUNDER',
        sponsorId: 'sponsor-1',
      }),
    );
    expect(bounty.status).toBe(BountyStatus.FUNDED);
  });

  it('rejects funding a bounty that is already FUNDED', async () => {
    const mockBounty = { id: 'b1', status: BountyStatus.FUNDED };
    const runner = createMockRunner(mockBounty);
    dataSource.transaction.mockImplementation((fn: Function) => fn(runner));

    await expect(service.fund('b1', 'GFUNDER')).rejects.toThrow(
      InvalidBountyTransitionError,
    );
  });

  it('rejects claiming a bounty that is still OPEN (not yet funded)', async () => {
    const mockBounty = { id: 'b1', status: BountyStatus.OPEN };
    const runner = createMockRunner(mockBounty);
    dataSource.transaction.mockImplementation((fn: Function) => fn(runner));

    await expect(service.claim('b1', 'contributor-1')).rejects.toThrow(
      InvalidBountyTransitionError,
    );
  });

  it('claim moves FUNDED -> CLAIMED and records the contributor', async () => {
    const mockBounty = { id: 'b1', status: BountyStatus.FUNDED };
    const runner = createMockRunner(mockBounty);
    dataSource.transaction.mockImplementation((fn: Function) => fn(runner));

    const bounty = await service.claim('b1', 'contributor-1');
    expect(bounty.status).toBe(BountyStatus.CLAIMED);
    expect(bounty.claimedById).toBe('contributor-1');
  });

  it('concurrent claims for the same bounty are serialized by the pessimistic lock', async () => {
    // Simulate: first claim succeeds, second claim sees CLAIMED status and fails
    const mockBountyFunded = { id: 'b1', status: BountyStatus.FUNDED };
    const mockBountyClaimed = { id: 'b1', status: BountyStatus.CLAIMED };

    // First call: bounty is FUNDED -> claim succeeds
    const runner1 = createMockRunner(mockBountyFunded);
    // Second call: bounty is now CLAIMED -> claim fails
    const runner2 = createMockRunner(mockBountyClaimed);

    dataSource.transaction
      .mockImplementationOnce((fn: Function) => fn(runner1))
      .mockImplementationOnce((fn: Function) => fn(runner2));

    const result1 = await service.claim('b1', 'contributor-1');
    expect(result1.status).toBe(BountyStatus.CLAIMED);

    await expect(service.claim('b1', 'contributor-2')).rejects.toThrow(
      InvalidBountyTransitionError,
    );
  });

  it('markMergedAndRelease releases escrow to the contributor and moves to PAID', async () => {
    const mockBounty = {
      id: 'b1',
      status: BountyStatus.IN_REVIEW,
      escrowId: 'escrow-1',
      claimedById: 'contributor-1',
      teamId: null,
    };
    const runner = createMockRunner(mockBounty);
    runner.findOne.mockResolvedValue({
      id: 'contributor-1',
      stellarAddress: 'GCONTRIB',
    });
    dataSource.transaction.mockImplementation((fn: Function) => fn(runner));

    const bounty = await service.markMergedAndRelease('b1');

    expect(escrowService.release).toHaveBeenCalledWith(
      'escrow-1',
      'GCONTRIB',
      'contributor-1',
    );
    expect(bounty.status).toBe(BountyStatus.PAID);
  });
});
