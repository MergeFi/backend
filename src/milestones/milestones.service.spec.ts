import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MilestonesService } from './milestones.service';
import { EscrowService } from '../escrow/escrow.service';
import { Issue, Milestone } from '../common/entities';
import { AssetType, MilestoneStatus } from '../common/enums';

describe('MilestonesService', () => {
  let service: MilestonesService;
  let milestoneRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let issueRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let escrowService: {
    fund: jest.Mock;
    releasePartial: jest.Mock;
  };
  let dataSource: {
    transaction: jest.Mock;
  };

  beforeEach(async () => {
    milestoneRepo = {
      findOne: jest.fn(),
      save: jest.fn((m: Partial<Milestone>) => Promise.resolve(m)),
      update: jest.fn(),
    };
    issueRepo = {
      findOne: jest.fn(),
      save: jest.fn((i: Partial<Issue>) => Promise.resolve(i)),
    };
    escrowService = {
      fund: jest.fn().mockResolvedValue({ id: 'escrow-1', status: 'locked' }),
      releasePartial: jest.fn().mockResolvedValue({
        id: 'payment-1',
        amount: '100',
        status: 'confirmed',
      }),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((fn: Function) =>
        fn({
          update: jest.fn(),
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestonesService,
        { provide: getRepositoryToken(Milestone), useValue: milestoneRepo },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
        { provide: EscrowService, useValue: escrowService },
        { provide: DataSource, useValue: dataSource },
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
    it('attaches an issue to an OPEN milestone in the same repository', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.OPEN,
        repositoryId: 'repo-a',
      });
      issueRepo.findOne.mockResolvedValue({
        id: 'i1',
        state: 'open',
        repositoryId: 'repo-a',
      });

      const issue = await service.addIssue('m1', 'i1');

      expect(issue.milestoneId).toBe('m1');
      expect(issueRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'i1', milestoneId: 'm1' }),
      );
    });

    it('attaches an issue to a FUNDED milestone in the same repository', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.FUNDED,
        repositoryId: 'repo-a',
      });
      issueRepo.findOne.mockResolvedValue({
        id: 'i1',
        state: 'open',
        repositoryId: 'repo-a',
      });

      const issue = await service.addIssue('m1', 'i1');

      expect(issue.milestoneId).toBe('m1');
    });

    it('attaches an issue to an IN_PROGRESS milestone in the same repository', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.IN_PROGRESS,
        repositoryId: 'repo-a',
      });
      issueRepo.findOne.mockResolvedValue({
        id: 'i1',
        state: 'open',
        repositoryId: 'repo-a',
      });

      const issue = await service.addIssue('m1', 'i1');

      expect(issue.milestoneId).toBe('m1');
    });

    it('rejects attaching an issue from a different repository than the milestone', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.OPEN,
        repositoryId: 'repo-a',
      });
      issueRepo.findOne.mockResolvedValue({
        id: 'i1',
        state: 'open',
        repositoryId: 'repo-b',
      });

      await expect(service.addIssue('m1', 'i1')).rejects.toThrow(
        'Issue i1 belongs to repository repo-b, but milestone m1 is scoped to repository repo-a',
      );
      expect(issueRepo.save).not.toHaveBeenCalled();
    });

    it('rejects attaching an issue to a COMPLETED milestone', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.COMPLETED,
      });

      await expect(service.addIssue('m1', 'i1')).rejects.toThrow(
        'Cannot attach issue to milestone in completed status',
      );
    });

    it('rejects attaching an issue to a CLOSED milestone', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.CLOSED,
      });

      await expect(service.addIssue('m1', 'i1')).rejects.toThrow(
        'Cannot attach issue to milestone in closed status',
      );
    });

    it('throws NotFoundException when the issue does not exist', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.OPEN,
      });
      issueRepo.findOne.mockResolvedValue(null);

      await expect(service.addIssue('m1', 'i1')).rejects.toThrow(
        'Issue i1 not found',
      );
    });
  });

  describe('resolveIssue', () => {
    it('releases payment and closes the issue within a transaction', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.FUNDED,
        escrowId: 'escrow-1',
        budget: '500',
        distributed: '0',
        issues: [{ id: 'i1', state: 'open' }, { id: 'i2', state: 'open' }],
      });

      const payment = await service.resolveIssue(
        'm1',
        'i1',
        'RECIPIENT_ADDR',
        'user-1',
      );

      expect(escrowService.releasePartial).toHaveBeenCalledWith(
        'escrow-1',
        '250.0000000',
        'RECIPIENT_ADDR',
        'user-1',
      );
      expect(payment.id).toBe('payment-1');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('marks milestone as COMPLETED when budget is fully distributed', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.FUNDED,
        escrowId: 'escrow-1',
        budget: '500',
        distributed: '499.9999999',
        issues: [{ id: 'i1', state: 'open' }],
      });

      await service.resolveIssue('m1', 'i1', 'RECIPIENT_ADDR');

      const txFn = dataSource.transaction.mock.calls[0][0];
      const mockMgr = { update: jest.fn() };
      await txFn(mockMgr);

      expect(mockMgr.update).toHaveBeenCalledWith(
        Milestone,
        'm1',
        expect.objectContaining({ status: MilestoneStatus.COMPLETED }),
      );
    });

    it('sets status to IN_PROGRESS when budget remains after distribution', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.FUNDED,
        escrowId: 'escrow-1',
        budget: '500',
        distributed: '0',
        issues: [
          { id: 'i1', state: 'open' },
          { id: 'i2', state: 'open' },
          { id: 'i3', state: 'open' },
        ],
      });

      await service.resolveIssue('m1', 'i1', 'RECIPIENT_ADDR');

      const transactionFn = dataSource.transaction.mock.calls[0][0];
      const mockMgr = { update: jest.fn() };
      await transactionFn(mockMgr);

      expect(mockMgr.update).toHaveBeenCalledWith(
        Milestone,
        'm1',
        expect.objectContaining({ status: MilestoneStatus.IN_PROGRESS }),
      );
    });

    it('rejects when milestone has no escrow', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.OPEN,
        escrowId: null,
        issues: [],
      });

      await expect(
        service.resolveIssue('m1', 'i1', 'RECIPIENT_ADDR'),
      ).rejects.toThrow('Milestone m1 has not been funded yet');
    });

    it('rejects when milestone status is not FUNDED or IN_PROGRESS', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.OPEN,
        escrowId: 'escrow-1',
        issues: [],
      });

      await expect(
        service.resolveIssue('m1', 'i1', 'RECIPIENT_ADDR'),
      ).rejects.toThrow('Milestone m1 is not accepting distributions');
    });

    it('rejects when the issue does not belong to the milestone (#114)', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.FUNDED,
        escrowId: 'escrow-1',
        budget: '100',
        distributed: '0',
        issues: [{ id: 'issue-aaa', state: 'open' }],
      });

      await expect(
        service.resolveIssue('m1', 'issue-999', 'RECIPIENT'),
      ).rejects.toThrow(BadRequestException);

      expect(escrowService.releasePartial).not.toHaveBeenCalled();
    });

    it('rejects when no open issues remain (#115)', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.FUNDED,
        escrowId: 'escrow-1',
        budget: '100',
        distributed: '0',
        issues: [
          { id: 'issue-1', state: 'closed' },
          { id: 'issue-2', state: 'closed' },
        ],
      });

      await expect(
        service.resolveIssue('m1', 'issue-1', 'RECIPIENT'),
      ).rejects.toThrow('No unresolved issues left to attribute this payout to');

      expect(escrowService.releasePartial).not.toHaveBeenCalled();
    });

    it('releases an equal share of remaining budget across open issues', async () => {
      milestoneRepo.findOne.mockResolvedValue({
        id: 'm1',
        status: MilestoneStatus.FUNDED,
        escrowId: 'escrow-1',
        budget: '1000',
        distributed: '0',
        issues: [
          { id: 'i1', state: 'open' },
          { id: 'i2', state: 'open' },
          { id: 'i3', state: 'open' },
          { id: 'i4', state: 'closed' },
        ],
      });

      await service.resolveIssue('m1', 'i1', 'RECIPIENT_ADDR');

      // 3 open issues, remaining budget = 1000, share = 1000/3 = 333.3333333
      expect(escrowService.releasePartial).toHaveBeenCalledWith(
        'escrow-1',
        '333.3333333',
        'RECIPIENT_ADDR',
        undefined,
      );
    });
  });
});
