import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BountiesService } from './bounties.service';
import { EscrowService } from '../escrow/escrow.service';
import { Bounty, Team, User } from '../common/entities';
import { AssetType, BountyDifficulty, BountyStatus } from '../common/enums';
import { InvalidBountyTransitionError } from './bounty-state-machine';

describe('BountiesService', () => {
  let service: BountiesService;
  let bountyRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let escrowService: {
    fund: jest.Mock;
    release: jest.Mock;
    splitRelease: jest.Mock;
  };

  beforeEach(async () => {
    bountyRepo = {
      findOne: jest.fn(),
      save: jest.fn((b: Partial<Bounty>) => Promise.resolve(b)),
      create: jest.fn((data: Partial<Bounty>) => ({
        id: 'bounty-1',
        status: BountyStatus.OPEN,
        ...data,
      })),
    };
    escrowService = {
      fund: jest.fn().mockResolvedValue({ id: 'escrow-1', status: 'locked' }),
      release: jest.fn().mockResolvedValue(undefined),
      splitRelease: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BountiesService,
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Team), useValue: { findOne: jest.fn() } },
        { provide: EscrowService, useValue: escrowService },
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
    bountyRepo.findOne.mockResolvedValue({
      id: 'b1',
      status: BountyStatus.OPEN,
      amount: '100',
      asset: AssetType.USDC,
    });

    const bounty = await service.fund('b1', 'GFUNDER');

    expect(escrowService.fund).toHaveBeenCalledWith(
      expect.objectContaining({ bountyId: 'b1', funderAddress: 'GFUNDER' }),
    );
    expect(bounty.status).toBe(BountyStatus.FUNDED);
  });

  it('rejects funding a bounty that is already FUNDED', async () => {
    bountyRepo.findOne.mockResolvedValue({
      id: 'b1',
      status: BountyStatus.FUNDED,
    });
    await expect(service.fund('b1', 'GFUNDER')).rejects.toThrow(
      InvalidBountyTransitionError,
    );
  });

  it('rejects claiming a bounty that is still OPEN (not yet funded)', async () => {
    bountyRepo.findOne.mockResolvedValue({
      id: 'b1',
      status: BountyStatus.OPEN,
    });
    await expect(service.claim('b1', 'contributor-1')).rejects.toThrow(
      InvalidBountyTransitionError,
    );
  });

  it('claim moves FUNDED -> CLAIMED and records the contributor', async () => {
    bountyRepo.findOne.mockResolvedValue({
      id: 'b1',
      status: BountyStatus.FUNDED,
    });
    const bounty = await service.claim('b1', 'contributor-1');
    expect(bounty.status).toBe(BountyStatus.CLAIMED);
    expect(bounty.claimedById).toBe('contributor-1');
  });

  it('markMergedAndRelease releases escrow to the contributor and moves to PAID', async () => {
    bountyRepo.findOne.mockResolvedValue({
      id: 'b1',
      status: BountyStatus.IN_REVIEW,
      escrowId: 'escrow-1',
      claimedById: 'contributor-1',
      teamId: null,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BountiesService,
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: 'contributor-1',
              stellarAddress: 'GCONTRIB',
            }),
          },
        },
        { provide: getRepositoryToken(Team), useValue: { findOne: jest.fn() } },
        { provide: EscrowService, useValue: escrowService },
      ],
    }).compile();
    service = module.get(BountiesService);

    const bounty = await service.markMergedAndRelease('b1');

    expect(escrowService.release).toHaveBeenCalledWith(
      'escrow-1',
      'GCONTRIB',
      'contributor-1',
    );
    expect(bounty.status).toBe(BountyStatus.PAID);
  });
});
