import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MilestonesController } from './milestones.controller';
import { MilestonesService } from './milestones.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { AssetType, MilestoneStatus } from '../common/enums';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('MilestonesController', () => {
  let controller: MilestonesController;
  let milestonesService: {
    create: jest.Mock;
    findOne: jest.Mock;
    list: jest.Mock;
    fund: jest.Mock;
    addIssue: jest.Mock;
    resolveIssue: jest.Mock;
    allocateBudget: jest.Mock;
  };

  beforeEach(async () => {
    milestonesService = {
      create: jest.fn().mockResolvedValue({ id: 'm1', status: MilestoneStatus.OPEN }),
      findOne: jest.fn().mockResolvedValue({ id: 'm1', status: MilestoneStatus.OPEN }),
      list: jest.fn().mockResolvedValue([]),
      fund: jest.fn().mockResolvedValue({ id: 'm1', status: MilestoneStatus.FUNDED }),
      addIssue: jest.fn().mockResolvedValue({ id: 'm1' }),
      resolveIssue: jest.fn().mockResolvedValue({ id: 'm1' }),
      allocateBudget: jest.fn().mockResolvedValue({ id: 'm1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MilestonesController],
      providers: [{ provide: MilestonesService, useValue: milestonesService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(MilestonesController);
  });

  describe('create', () => {
    it('calls milestonesService.create with the provided DTO', async () => {
      const dto = {
        repositoryId: '00000000-0000-0000-0000-000000000001',
        title: 'Test Milestone',
        budget: '500',
        asset: AssetType.USDC,
      };

      await controller.create(dto);

      expect(milestonesService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findOne', () => {
    it('calls milestonesService.findOne with the route param', async () => {
      await controller.findOne('m1');

      expect(milestonesService.findOne).toHaveBeenCalledWith('m1');
    });
  });

  describe('list', () => {
    it('calls milestonesService.list', async () => {
      await controller.list();

      expect(milestonesService.list).toHaveBeenCalled();
    });
  });

  describe('fund', () => {
    it('calls milestonesService.fund with id and funderAddress', async () => {
      await controller.fund('m1', { funderAddress: 'GFUNDER' });

      expect(milestonesService.fund).toHaveBeenCalledWith('m1', 'GFUNDER');
    });
  });

  describe('addIssue', () => {
    it('calls milestonesService.addIssue with id and issueId', async () => {
      await controller.addIssue('m1', 'i1');

      expect(milestonesService.addIssue).toHaveBeenCalledWith('m1', 'i1');
    });
  });

  describe('resolveIssue', () => {
    it('calls milestonesService.resolveIssue with id, issueId, recipientAddress, and recipientId', async () => {
      await controller.resolveIssue('m1', 'i1', {
        recipientAddress: 'GADDR',
        recipientId: 'u1',
      });

      expect(milestonesService.resolveIssue).toHaveBeenCalledWith('m1', 'i1', 'GADDR', 'u1');
    });
  });

  describe('allocateBudget', () => {
    it('calls milestonesService.allocateBudget with the route param', async () => {
      await controller.allocateBudget('m1');

      expect(milestonesService.allocateBudget).toHaveBeenCalledWith('m1');
    });
  });

  describe('CreateMilestoneDto validation', () => {
    it('rejects a body with no repositoryId', async () => {
      const dto = plainToInstance(CreateMilestoneDto, {
        title: 'Test',
        budget: '100',
        asset: AssetType.USDC,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects a body with no title', async () => {
      const dto = plainToInstance(CreateMilestoneDto, {
        repositoryId: '00000000-0000-0000-0000-000000000001',
        budget: '100',
        asset: AssetType.USDC,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects a body with no budget', async () => {
      const dto = plainToInstance(CreateMilestoneDto, {
        repositoryId: '00000000-0000-0000-0000-000000000001',
        title: 'Test',
        asset: AssetType.USDC,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects a body with no asset', async () => {
      const dto = plainToInstance(CreateMilestoneDto, {
        repositoryId: '00000000-0000-0000-0000-000000000001',
        title: 'Test',
        budget: '100',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
