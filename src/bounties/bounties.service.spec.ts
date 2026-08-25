import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BountiesService } from './bounties.service';
import { Bounty } from '../common/entities/bounty.entity';
import { BountyStatus } from '../common/enums';
import { EscrowService } from '../escrow/escrow.service';
import { TeamService } from '../teams/teams.service';
import { InvalidBountyTransitionError } from './bounty-state-machine';
import { NotFoundException } from '@nestjs/common';

const mockBountyRepo = () => ({
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
});

const mockEscrowService = () => ({
  release: jest.fn(),
  splitRelease: jest.fn(),
  refund: jest.fn(),
  fund: jest.fn(),
});

const mockTeamService = () => ({
  findOne: jest.fn(),
});

describe('BountiesService', () => {
  let service: BountiesService;
  let bountyRepo: jest.Mocked<Repository<Bounty>>;
  let escrowService: jest.Mocked<EscrowService>;
  let teamService: jest.Mocked<TeamService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BountiesService,
        { provide: 'BOUNTY_REPOSITORY', useFactory: mockBountyRepo },
        { provide: EscrowService, useFactory: mockEscrowService },
        { provide: TeamService, useFactory: mockTeamService },
      ],
    }).compile();

    service = module.get<BountiesService>(BountiesService);
    bountyRepo = module.get('BOUNTY_REPOSITORY');
    escrowService = module.get(EscrowService);
    teamService = module.get(TeamService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('markMergedAndRelease', () => {
    const baseBounty = {
      id: 'bounty-1',
      escrowId: 'escrow-1',
      claimedById: 'user-1',
      teamId: null,
      claimedBy: { id: 'user-1', stellarAddress: 'GCLAIM...' },
      status: BountyStatus.CLAIMED,
      mergedAt: null,
      paidAt: null,
    };

    it('should mark bounty as MERGED then PAID after successful release', async () => {
      const bounty = { ...baseBounty } as Bounty;
      bountyRepo.findOne.mockResolvedValue(bounty);
      bountyRepo.save.mockImplementation(async (b) => b);
      escrowService.release.mockResolvedValue(undefined);

      const result = await service.markMergedAndRelease('bounty-1');

      expect(bountyRepo.save).toHaveBeenCalledTimes(2); // MERGED then PAID
      expect(result.status).toBe(BountyStatus.PAID);
      expect(result.paidAt).toBeInstanceOf(Date);
      expect(escrowService.release).toHaveBeenCalledWith('escrow-1', 'GCLAIM...');
    });

    it('should throw InvalidBountyTransitionError if bounty not in valid state for MERGED', async () => {
      const bounty = { ...baseBounty, status: BountyStatus.OPEN } as Bounty;
      bountyRepo.findOne.mockResolvedValue(bounty);

      await expect(service.markMergedAndRelease('bounty-1')).rejects.toThrow(InvalidBountyTransitionError);
      expect(escrowService.release).not.toHaveBeenCalled();
    });

    it('should persist MERGED status even if escrow release throws', async () => {
      const bounty = { ...baseBounty } as Bounty;
      bountyRepo.findOne.mockResolvedValue(bounty);
      bountyRepo.save.mockImplementation(async (b) => b);
      escrowService.release.mockRejectedValue(new Error('Soroban RPC timeout'));

      await expect(service.markMergedAndRelease('bounty-1')).rejects.toThrow('Soroban RPC timeout');

      // First save should have been called with MERGED status
      expect(bountyRepo.save).toHaveBeenCalledTimes(1);
      expect(bountyRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: BountyStatus.MERGED }));
      expect(bounty.status).toBe(BountyStatus.MERGED);
    });

    it('should allow retry after failed release by calling markMergedAndRelease again (idempotent release)', async () => {
      // First call: release fails, bounty stuck in MERGED
      const bounty = { ...baseBounty } as Bounty;
      bountyRepo.findOne.mockResolvedValue(bounty);
      bountyRepo.save.mockImplementation(async (b) => b);
      escrowService.release.mockRejectedValueOnce(new Error('Network blip'));

      await expect(service.markMergedAndRelease('bounty-1')).rejects.toThrow('Network blip');
      expect(bounty.status).toBe(BountyStatus.MERGED);
      expect(bountyRepo.save).toHaveBeenCalledTimes(1);

      // Reset mocks for retry call
      jest.clearAllMocks();
      bountyRepo.findOne.mockResolvedValue(bounty); // bounty now has status MERGED
      bountyRepo.save.mockImplementation(async (b) => b);
      escrowService.release.mockResolvedValueOnce(undefined);

      // Second call: should skip MERGED transition, attempt release again, succeed, move to PAID
      const result = await service.markMergedAndRelease('bounty-1');

      expect(escrowService.release).toHaveBeenCalledWith('escrow-1', 'GCLAIM...');
      expect(bountyRepo.save).toHaveBeenCalledTimes(1); // only PAID save
      expect(bountyRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: BountyStatus.PAID }));
      expect(result.status).toBe(BountyStatus.PAID);
      expect(result.paidAt).toBeInstanceOf(Date);
    });

    it('should handle team splitRelease retry similarly', async () => {
      const teamBounty = {
        ...baseBounty,
        teamId: 'team-1',
        claimedById: null,
        claimedBy: null,
        team: {
          id: 'team-1',
          members: [
            { user: { id: 'user-1', stellarAddress: 'GUSER1...' }, shareBps: 5000 },
            { user: { id: 'user-2', stellarAddress: 'GUSER2...' }, shareBps: 5000 },
          ],
        },
      } as unknown as Bounty;

      bountyRepo.findOne.mockResolvedValue(teamBounty);
      bountyRepo.save.mockImplementation(async (b) => b);
      teamService.findOne.mockResolvedValue(teamBounty.team);
      escrowService.splitRelease.mockRejectedValueOnce(new Error('Simulation failed'));

      await expect(service.markMergedAndRelease('bounty-1')).rejects.toThrow('Simulation failed');
      expect(teamBounty.status).toBe(BountyStatus.MERGED);

      // Retry
      jest.clearAllMocks();
      bountyRepo.findOne.mockResolvedValue(teamBounty);
      bountyRepo.save.mockImplementation(async (b) => b);
      teamService.findOne.mockResolvedValue(teamBounty.team);
      escrowService.splitRelease.mockResolvedValueOnce(undefined);

      const result = await service.markMergedAndRelease('bounty-1');

      expect(escrowService.splitRelease).toHaveBeenCalledWith('escrow-1', [
        { address: 'GUSER1...', shareBps: 5000 },
        { address: 'GUSER2...', shareBps: 5000 },
      ]);
      expect(result.status).toBe(BountyStatus.PAID);
    });

    it('should return early without release if no escrowId', async () => {
      const bounty = { ...baseBounty, escrowId: null } as Bounty;
      bountyRepo.findOne.mockResolvedValue(bounty);
      bountyRepo.save.mockImplementation(async (b) => b);

      const result = await service.markMergedAndRelease('bounty-1');

      expect(result.status).toBe(BountyStatus.MERGED);
      expect(escrowService.release).not.toHaveBeenCalled();
    });
  });

  describe('refund', () => {
    it('should refund escrow and mark bounty REFUNDED', async () => {
      const bounty = {
        id: 'bounty-1',
        escrowId: 'escrow-1',
        status: BountyStatus.MERGED,
      } as Bounty;
      bountyRepo.findOne.mockResolvedValue(bounty);
      bountyRepo.save.mockImplementation(async (b) => b);
      escrowService.refund.mockResolvedValue(undefined);

      const result = await service.refund('bounty-1');

      expect(escrowService.refund).toHaveBeenCalledWith('escrow-1');
      expect(result.status).toBe(BountyStatus.REFUNDED);
      expect(result.refundedAt).toBeInstanceOf(Date);
    });

    it('should throw InvalidBountyTransitionError if not in MERGED', async () => {
      const bounty = { id: 'bounty-1', status: BountyStatus.PAID } as Bounty;
      bountyRepo.findOne.mockResolvedValue(bounty);

      await expect(service.refund('bounty-1')).rejects.toThrow(InvalidBountyTransitionError);
    });
  });
});
