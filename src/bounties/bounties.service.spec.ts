import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BountiesService } from './bounties.service';
import { EscrowService } from '../escrow/escrow.service';
import { Bounty, Team, User } from '../common/entities';
import { AssetType, BountyDifficulty, BountyStatus } from '../common/enums';
import { InvalidBountyTransitionError } from './bounty-state-machine';

describe('BountiesService', () => {
  let service: BountiesService;
  let bountyRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let userRepo: { findOne: jest.Mock; find: jest.Mock };
  let teamRepo: { findOne: jest.Mock };
  let escrowService: {
    fund: jest.Mock;
    release: jest.Mock;
    splitRelease: jest.Mock;
    refund: jest.Mock;
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
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    userRepo = { findOne: jest.fn(), find: jest.fn() };
    teamRepo = { findOne: jest.fn() };
    escrowService = {
      fund: jest.fn().mockResolvedValue({ id: 'escrow-1', status: 'locked' }),
      release: jest.fn().mockResolvedValue(undefined),
      splitRelease: jest.fn().mockResolvedValue([]),
      refund: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BountiesService,
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Team), useValue: teamRepo },
        { provide: EscrowService, useValue: escrowService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
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
      sponsorId: 'sponsor-1',
    });

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

  it('threads the linked GitHub issue id and deadline into escrow.fund (#158)', async () => {
    const deadline = new Date('2026-12-01T00:00:00.000Z');
    bountyRepo.findOne.mockResolvedValue({
      id: 'b1',
      status: BountyStatus.OPEN,
      amount: '100',
      asset: AssetType.USDC,
      sponsorId: 'sponsor-1',
      deadline,
      issue: { githubIssueId: '2891234567' },
    });

    await service.fund('b1', 'GFUNDER');

    expect(escrowService.fund).toHaveBeenCalledWith(
      expect.objectContaining({
        onChainIssueId: '2891234567',
        deadline,
      }),
    );
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
    userRepo.findOne.mockResolvedValue({
      id: 'contributor-1',
      stellarAddress: 'GCONTRIB',
    });

    const bounty = await service.markMergedAndRelease('b1');

    expect(escrowService.release).toHaveBeenCalledWith(
      'escrow-1',
      'GCONTRIB',
      'contributor-1',
    );
    expect(bounty.status).toBe(BountyStatus.PAID);
  });

  it('markMergedAndRelease batches user lookups for team splits', async () => {
    bountyRepo.findOne.mockResolvedValue({
      id: 'b1',
      status: BountyStatus.IN_REVIEW,
      escrowId: 'escrow-1',
      claimedById: null,
      teamId: 'team-1',
    });
    teamRepo.findOne.mockResolvedValue({
      id: 'team-1',
      splits: [
        { userId: 'u1', percentage: 60 },
        { userId: 'u2', percentage: 40 },
      ],
    });
    userRepo.find.mockResolvedValue([
      { id: 'u1', stellarAddress: 'GADDR1' },
      { id: 'u2', stellarAddress: 'GADDR2' },
    ]);

    const bounty = await service.markMergedAndRelease('b1');

    expect(userRepo.find).toHaveBeenCalledTimes(1);
    const findCall = userRepo.find.mock.calls[0][0];
    expect(findCall.where.id._value).toEqual(
      expect.arrayContaining(['u1', 'u2']),
    );
    expect(escrowService.splitRelease).toHaveBeenCalledWith('escrow-1', [
      { recipientId: 'u1', recipientAddress: 'GADDR1', percentage: 60 },
      { recipientId: 'u2', recipientAddress: 'GADDR2', percentage: 40 },
    ]);
    expect(bounty.status).toBe(BountyStatus.PAID);
  });

  it('refund calls escrowService.refund and moves bounty to REFUNDED', async () => {
    bountyRepo.findOne.mockResolvedValue({
      id: 'b1',
      status: BountyStatus.FUNDED,
      escrowId: 'escrow-1',
    });

    const bounty = await service.refund('b1');

    expect(escrowService.refund).toHaveBeenCalledWith('escrow-1');
    expect(bounty.status).toBe(BountyStatus.REFUNDED);
  });

  it('refund skips escrow refund when no escrow is linked', async () => {
    bountyRepo.findOne.mockResolvedValue({
      id: 'b1',
      status: BountyStatus.OPEN,
      escrowId: null,
    });

    const bounty = await service.refund('b1');

    expect(escrowService.refund).not.toHaveBeenCalled();
    expect(bounty.status).toBe(BountyStatus.REFUNDED);
  });

  it('expireOverdue flips overdue bounties to EXPIRED and returns count', async () => {
    const overdueBounties = [
      { id: 'b1', status: BountyStatus.OPEN },
      { id: 'b2', status: BountyStatus.FUNDED },
    ];
    const mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(overdueBounties),
    };
    bountyRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    const count = await service.expireOverdue();

    expect(count).toBe(2);
    expect(bountyRepo.save).toHaveBeenCalledTimes(2);
    expect(overdueBounties[0].status).toBe(BountyStatus.EXPIRED);
    expect(overdueBounties[1].status).toBe(BountyStatus.EXPIRED);
  });

  it('markPrClosedWithoutMerge transitions IN_REVIEW back to CLAIMED', async () => {
    bountyRepo.findOne.mockResolvedValue({
      id: 'b1',
      status: BountyStatus.IN_REVIEW,
      prUrl: 'https://github.com/x/y/pull/1',
      prNumber: 1,
    });

    const bounty = await service.markPrClosedWithoutMerge('b1');

    expect(bounty.status).toBe(BountyStatus.CLAIMED);
    expect(bounty.prUrl).toBeNull();
    expect(bounty.prNumber).toBeNull();
  });

  it('markPrClosedWithoutMerge rejects bounties not in IN_REVIEW', async () => {
    bountyRepo.findOne.mockResolvedValue({
      id: 'b1',
      status: BountyStatus.CLAIMED,
    });

    await expect(service.markPrClosedWithoutMerge('b1')).rejects.toThrow(
      InvalidBountyTransitionError,
    );
  });

  it('lists bounties with repository and language filters', async () => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    bountyRepo.createQueryBuilder.mockReturnValue(qb);

    await service.list({
      status: BountyStatus.OPEN,
      difficulty: BountyDifficulty.BEGINNER,
      asset: AssetType.USDC,
      repositoryId: 'repo-1',
      primaryLanguage: 'TypeScript',
    });

    expect(bountyRepo.createQueryBuilder).toHaveBeenCalledWith('bounty');
    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('bounty.issue', 'issue');
    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
      'issue.repository',
      'repository',
    );
    expect(qb.andWhere).toHaveBeenCalledWith('bounty.status = :status', {
      status: BountyStatus.OPEN,
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      'bounty.difficulty = :difficulty',
      { difficulty: BountyDifficulty.BEGINNER },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('bounty.asset = :asset', {
      asset: AssetType.USDC,
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      'issue.repositoryId = :repositoryId',
      { repositoryId: 'repo-1' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'repository.primaryLanguage = :primaryLanguage',
      { primaryLanguage: 'TypeScript' },
    );
  });
});
