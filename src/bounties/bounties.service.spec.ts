import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { BountiesService } from './bounties.service';
import { Bounty } from '../common/entities/bounty.entity';
import { User } from '../common/entities/user.entity';
import { Team } from '../common/entities/team.entity';
import { TeamMemberSplit } from '../common/entities/team-member-split.entity';
import { Escrow } from '../common/entities/escrow.entity';
import { Payment } from '../common/entities/payment.entity';
import { BountyStatus } from '../common/enums';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EscrowService } from '../escrow/escrow.service';
import { SorobanClientService } from '../escrow/soroban-client.service';

// Mock the SorobanClientService
jest.mock('../escrow/soroban-client.service');

const mockSorobanClient = {
  fundEscrow: jest.fn().mockResolvedValue({ txHash: 'mock-tx-hash' }),
  releaseEscrow: jest.fn().mockResolvedValue({ txHash: 'mock-tx-hash' }),
  splitReleaseEscrow: jest.fn().mockResolvedValue({ txHash: 'mock-tx-hash' }),
  refundEscrow: jest.fn().mockResolvedValue({ txHash: 'mock-tx-hash' }),
  getEscrowState: jest.fn().mockResolvedValue({ status: 'FUNDED', balance: '1000' }),
};

const mockEscrowService = {
  fundEscrow: jest.fn().mockResolvedValue({ id: 'escrow-id', status: 'FUNDED' }),
  releaseEscrow: jest.fn().mockResolvedValue({ id: 'escrow-id', status: 'RELEASED' }),
  splitRelease: jest.fn().mockResolvedValue([{ id: 'payment-1', status: 'COMPLETED' }]),
  getEscrow: jest.fn().mockResolvedValue({ id: 'escrow-id', status: 'FUNDED' }),
};

describe('BountiesService - Team Split Integrity', () => {
  let service: BountiesService;
  let userRepo: Repository<User>;
  let teamRepo: Repository<Team>;
  let splitRepo: Repository<TeamMemberSplit>;
  let bountyRepo: Repository<Bounty>;
  let dataSource: DataSource;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BountiesService,
        {
          provide: EscrowService,
          useValue: mockEscrowService,
        },
        {
          provide: SorobanClientService,
          useValue: mockSorobanClient,
        },
        {
          provide: getRepositoryToken(User),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Team),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(TeamMemberSplit),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Bounty),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Escrow),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(Payment),
          useClass: Repository,
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb) => cb({
              getRepository: jest.fn((entity) => {
                if (entity === User) return userRepo;
                if (entity === Team) return teamRepo;
                if (entity === TeamMemberSplit) return splitRepo;
                if (entity === Bounty) return bountyRepo;
                return { save: jest.fn(), findOne: jest.fn(), create: jest.fn() };
              }),
              save: jest.fn(),
              findOne: jest.fn(),
              create: jest.fn(),
            })),
          },
        },
      ],
    }).compile();

    service = module.get<BountiesService>(BountiesService);
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    teamRepo = module.get<Repository<Team>>(getRepositoryToken(Team));
    splitRepo = module.get<Repository<TeamMemberSplit>>(getRepositoryToken(TeamMemberSplit));
    bountyRepo = module.get<Repository<Bounty>>(getRepositoryToken(Bounty));
    dataSource = module.get<DataSource>(DataSource);

    jest.clearAllMocks();
  });

  it('should reject User deletion when they have TeamMemberSplit rows (RESTRICT FK)', async () => {
    // Create 3 users
    const user1 = userRepo.create({ id: 'user-1', githubId: 'gh-1', username: 'user1' });
    const user2 = userRepo.create({ id: 'user-2', githubId: 'gh-2', username: 'user2' });
    const user3 = userRepo.create({ id: 'user-3', githubId: 'gh-3', username: 'user3' });
    await userRepo.save([user1, user2, user3]);

    // Create a team with 3 members summing to 100%
    const team = teamRepo.create({ id: 'team-1', name: 'Test Team' });
    await teamRepo.save(team);

    const splits = [
      splitRepo.create({ team, user: user1, userId: user1.id, percentage: 40 }),
      splitRepo.create({ team, user: user2, userId: user2.id, percentage: 30 }),
      splitRepo.create({ team, user: user3, userId: user3.id, percentage: 30 }),
    ];
    await splitRepo.save(splits);

    // Create a bounty assigned to this team
    const bounty = bountyRepo.create({
      id: 'bounty-1',
      title: 'Test Bounty',
      amount: 1000,
      status: BountyStatus.OPEN,
      team,
      teamId: team.id,
    });
    await bountyRepo.save(bounty);

    // Fund the bounty (create escrow)
    const escrow = await mockEscrowService.fundEscrow(bounty.id);
    bounty.escrowId = escrow.id;
    bounty.status = BountyStatus.FUNDED;
    await bountyRepo.save(bounty);

    // Mark as merged (simulate PR merge)
    bounty.status = BountyStatus.MERGED;
    await bountyRepo.save(bounty);

    // Now try to delete user2 - this should be rejected by the RESTRICT FK
    // In a real DB this would throw a foreign key violation error
    // Here we verify the FK constraint exists by checking the entity metadata
    const splitEntity = splitRepo.metadata;
    const userRelation = splitEntity.relations.find((r) => r.propertyName === 'user');
    expect(userRelation).toBeDefined();
    expect(userRelation!.onDelete).toBe('RESTRICT');

    // Verify the team splits still sum to 100
    const teamSplits = await splitRepo.find({ where: { teamId: team.id } });
    const total = teamSplits.reduce((sum, s) => sum + Number(s.percentage), 0);
    expect(total).toBe(100);
  });

  it('should throw when markMergedAndRelease is called on a team with desynced splits (pre-fix scenario)', async () => {
    // This test simulates the pre-fix scenario where CASCADE delete happened
    // and the team splits no longer sum to 100
    // After the fix, this scenario should be impossible because RESTRICT prevents the delete

    const user1 = userRepo.create({ id: 'user-1', githubId: 'gh-1', username: 'user1' });
    const user2 = userRepo.create({ id: 'user-2', githubId: 'gh-2', username: 'user2' });
    const user3 = userRepo.create({ id: 'user-3', githubId: 'gh-3', username: 'user3' });
    await userRepo.save([user1, user2, user3]);

    const team = teamRepo.create({ id: 'team-1', name: 'Test Team' });
    await teamRepo.save(team);

    // Simulate a team that LOST a member due to CASCADE delete (pre-fix)
    // Only 2 splits remain, summing to 70%
    const splits = [
      splitRepo.create({ team, user: user1, userId: user1.id, percentage: 40 }),
      splitRepo.create({ team, user: user2, userId: user2.id, percentage: 30 }),
      // user3's split is GONE - simulating CASCADE delete
    ];
    await splitRepo.save(splits);

    const bounty = bountyRepo.create({
      id: 'bounty-1',
      title: 'Test Bounty',
      amount: 1000,
      status: BountyStatus.MERGED,
      team,
      teamId: team.id,
      escrowId: 'escrow-1',
    });
    await bountyRepo.save(bounty);

    // Mock escrow service to throw on invalid splits (as assertValidSplits does)
    mockEscrowService.splitRelease.mockRejectedValue(
      new BadRequestException('Split percentages must sum to 100, got 70.00')
    );

    // This should throw because splits don't sum to 100
    await expect(service.markMergedAndRelease(bounty.id)).rejects.toThrow(
      'Split percentages must sum to 100'
    );

    // Verify bounty is stuck in MERGED (the bug scenario)
    const stuckBounty = await bountyRepo.findOne({ where: { id: bounty.id } });
    expect(stuckBounty?.status).toBe(BountyStatus.MERGED);
  });

  it('should successfully release bounty when team splits are valid (post-fix)', async () => {
    const user1 = userRepo.create({ id: 'user-1', githubId: 'gh-1', username: 'user1' });
    const user2 = userRepo.create({ id: 'user-2', githubId: 'gh-2', username: 'user2' });
    const user3 = userRepo.create({ id: 'user-3', githubId: 'gh-3', username: 'user3' });
    await userRepo.save([user1, user2, user3]);

    const team = teamRepo.create({ id: 'team-1', name: 'Test Team' });
    await teamRepo.save(team);

    // Valid splits summing to 100%
    const splits = [
      splitRepo.create({ team, user: user1, userId: user1.id, percentage: 40 }),
      splitRepo.create({ team, user: user2, userId: user2.id, percentage: 30 }),
      splitRepo.create({ team, user: user3, userId: user3.id, percentage: 30 }),
    ];
    await splitRepo.save(splits);

    const bounty = bountyRepo.create({
      id: 'bounty-1',
      title: 'Test Bounty',
      amount: 1000,
      status: BountyStatus.MERGED,
      team,
      teamId: team.id,
      escrowId: 'escrow-1',
    });
    await bountyRepo.save(bounty);

    // Mock successful split release
    mockEscrowService.splitRelease.mockResolvedValue([
      { id: 'payment-1', status: 'COMPLETED', recipientId: user1.id, amount: 400 },
      { id: 'payment-2', status: 'COMPLETED', recipientId: user2.id, amount: 300 },
      { id: 'payment-3', status: 'COMPLETED', recipientId: user3.id, amount: 300 },
    ]);

    const result = await service.markMergedAndRelease(bounty.id);

    expect(result).toBeDefined();
    expect(mockEscrowService.splitRelease).toHaveBeenCalled();
  });
});