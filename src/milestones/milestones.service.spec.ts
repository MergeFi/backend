import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MilestonesService } from './milestones.service';
import { EscrowService } from '../escrow/escrow.service';
import { Issue, Milestone } from '../common/entities';
import { AssetType, MilestoneStatus } from '../common/enums';

describe('MilestonesService', () => {
  let service: MilestonesService;
  let milestoneRepo: { findOne: jest.Mock; save: jest.Mock };
  let escrowService: { fund: jest.Mock };

  beforeEach(async () => {
    milestoneRepo = {
      findOne: jest.fn(),
      save: jest.fn((m: Partial<Milestone>) => Promise.resolve(m)),
    };
    escrowService = {
      fund: jest.fn().mockResolvedValue({ id: 'escrow-1', status: 'locked' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestonesService,
        { provide: getRepositoryToken(Milestone), useValue: milestoneRepo },
        {
          provide: getRepositoryToken(Issue),
          useValue: { findOne: jest.fn() },
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
});
