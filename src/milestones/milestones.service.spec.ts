import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MilestonesService } from './milestones.service';
import { EscrowService } from '../escrow/escrow.service';
import { Issue, Milestone } from '../common/entities';
import { AssetType, MilestoneStatus } from '../common/enums';

describe('MilestonesService', () => {
  let service: MilestonesService;
  let milestoneRepo: { findOne: jest.Mock; save: jest.Mock };
  let issueRepo: { findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
  let escrowService: { fund: jest.Mock; releasePartial: jest.Mock };

  beforeEach(async () => {
    milestoneRepo = {
      findOne: jest.fn(),
      save: jest.fn((m: Partial<Milestone>) => Promise.resolve(m)),
    };
    issueRepo = {
      findOne: jest.fn(),
      save: jest.fn((i: Partial<Issue>) => Promise.resolve(i)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    escrowService = {
      fund: jest.fn().mockResolvedValue({ id: 'escrow-1', status: 'locked' }),
      releasePartial: jest.fn().mockResolvedValue({ id: 'payment-1', amount: '100' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestonesService,
        { provide: getRepositoryToken(Milestone), useValue: milestoneRepo },
        {
          provide: getRepositoryToken(Issue),
          useValue: issueRepo,
        },
        { provide: EscrowService, useValue: escrowService },
      ],
    }).compile();

    service = module.get(MilestonesService);
  });

  describe('fund', () => {
    it('locks escrow for the milestone budget and moves OPEN -> FUNDED', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.OPEN,
        budget: '500',
        asset: AssetType.USDC,
        sponsorId: 'sponsor-1',
      });

      const milestone = await service.fund('m1', 'GFUNDER');

      expect(milestone.status).toBe(MilestoneStatus.FUNDED);
      expect(milestone.escrowId).toBe('escrow-1');
    });

    it('passes milestoneId and the milestone sponsorId through to EscrowService.fund', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.OPEN,
        budget: '500',
        asset: AssetType.USDC,
        sponsorId: 'sponsor-1',
      });

      await service.fund('m1', 'GFUNDER');

      expect(escrowService.fund).toHaveBeenCalledWith(
        expect.objectContaining({
          milestoneId: 'm1',
          funderAddress: 'GFUNDER',
          sponsorId: 'sponsor-1',
        }),
      );
    });

    it('still forwards a null sponsorId when the milestone has none set', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm2',
        status: MilestoneStatus.OPEN,
        budget: '500',
        asset: AssetType.USDC,
        sponsorId: null,
      });

      await service.fund('m2', 'GFUNDER');

      expect(escrowService.fund).toHaveBeenCalledWith(
        expect.objectContaining({ sponsorId: null }),
      );
    });

    it('rejects funding a milestone that is not OPEN', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.FUNDED,
      });

      await expect(service.fund('m1', 'GFUNDER')).rejects.toThrow(
        'Milestone m1 is not OPEN (current: funded)',
      );
    });
  });

  describe('addIssue', () => {
    it('successfully attaches an issue when repositoryId matches', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm-1',
        repositoryId: 'repo-a',
        issues: [],
      });
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-1',
        repositoryId: 'repo-a',
        milestoneId: null,
      });

      const result = await service.addIssue('m-1', 'issue-1');

      expect(result.milestoneId).toBe('m-1');
      expect(issueRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'issue-1',
          milestoneId: 'm-1',
        }),
      );
    });

    it('rejects attaching an issue from a different repository with clear mismatch details', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm-1',
        repositoryId: 'repo-a',
        issues: [],
      });
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-2',
        repositoryId: 'repo-b',
        milestoneId: null,
      });

      await expect(service.addIssue('m-1', 'issue-2')).rejects.toThrow(
        'Issue issue-2 (repository: repo-b) does not belong to Milestone m-1 repository (repo-a)',
      );
      expect(issueRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when issue does not exist', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm-1',
        repositoryId: 'repo-a',
        issues: [],
      });
      issueRepo.findOne.mockResolvedValue(null);

      await expect(service.addIssue('m-1', 'issue-missing')).rejects.toThrow(
        'Issue issue-missing not found',
      );
    });
  });

  describe('resolveIssue', () => {
    it('computes proportional share and resolves issue successfully', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm-1',
        repositoryId: 'repo-a',
        status: MilestoneStatus.FUNDED,
        escrowId: 'escrow-1',
        budget: '200.0000000',
        distributed: '0.0000000',
        issues: [
          { id: 'issue-1', state: 'open', repositoryId: 'repo-a' },
          { id: 'issue-2', state: 'open', repositoryId: 'repo-a' },
        ],
      });

      const payment = await service.resolveIssue(
        'm-1',
        'issue-1',
        'GRECIPIENT',
        'user-1',
      );

      expect(escrowService.releasePartial).toHaveBeenCalledWith(
        'escrow-1',
        '100.0000000',
        'GRECIPIENT',
        'user-1',
      );
      expect(issueRepo.update).toHaveBeenCalledWith('issue-1', {
        state: 'closed',
        closedAt: expect.any(Date),
      });
      expect(payment).toEqual({ id: 'payment-1', amount: '100' });
    });
  });
});
