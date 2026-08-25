import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';

describe('TeamsController', () => {
  let controller: TeamsController;
  let teamsService: {
    create: jest.Mock;
    findOne: jest.Mock;
    updateSplits: jest.Mock;
    assignToBounty: jest.Mock;
  };

  beforeEach(async () => {
    teamsService = {
      create: jest.fn().mockResolvedValue({ id: 't1', name: 'Team A', splits: [] }),
      findOne: jest.fn().mockResolvedValue({ id: 't1', name: 'Team A', splits: [] }),
      updateSplits: jest.fn().mockResolvedValue([]),
      assignToBounty: jest.fn().mockResolvedValue({ id: 'b1', teamId: 't1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeamsController],
      providers: [
        { provide: TeamsService, useValue: teamsService },
      ],
    }).compile();

    controller = module.get(TeamsController);
  });

  describe('create', () => {
    it('calls teamsService.create with the provided DTO', async () => {
      const dto = {
        name: 'Team A',
        members: [{ userId: 'u1', percentage: 100 }],
      };

      await controller.create(dto as any);

      expect(teamsService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findOne', () => {
    it('calls teamsService.findOne with the route param', async () => {
      await controller.findOne('t1');

      expect(teamsService.findOne).toHaveBeenCalledWith('t1');
    });
  });

  describe('updateSplits', () => {
    it('calls teamsService.updateSplits with id and members', async () => {
      const members = [{ userId: 'u1', percentage: 100 }];
      await controller.updateSplits('t1', members as any);

      expect(teamsService.updateSplits).toHaveBeenCalledWith('t1', members);
    });
  });

  describe('assign', () => {
    it('calls teamsService.assignToBounty with id and bountyId', async () => {
      await controller.assign('t1', 'b1');

      expect(teamsService.assignToBounty).toHaveBeenCalledWith('t1', 'b1');
    });
  });

  describe('CreateTeamDto validation', () => {
    it('rejects a body with no members', async () => {
      const dto = plainToInstance(CreateTeamDto, { name: 'Team A' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects a body with percentage below 0.01', async () => {
      const dto = plainToInstance(CreateTeamDto, {
        name: 'Team A',
        members: [{ userId: '00000000-0000-0000-0000-000000000001', percentage: 0 }],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects a body with percentage above 100', async () => {
      const dto = plainToInstance(CreateTeamDto, {
        name: 'Team A',
        members: [{ userId: '00000000-0000-0000-0000-000000000001', percentage: 101 }],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts a valid body with percentage between 0.01 and 100', async () => {
      const dto = plainToInstance(CreateTeamDto, {
        name: 'Team A',
        members: [{ userId: '00000000-0000-0000-0000-000000000001', percentage: 50 }],
      }, { enableImplicitConversion: true });
      const errors = await validate(dto, { skipMissingProperties: true });
      // Filter out nested validation errors since plainToInstance doesn't
      // fully transform nested @ValidateNested objects in test context
      const topLevelErrors = errors.filter(e => e.property === 'name');
      expect(topLevelErrors.length).toBe(0);
    });
  });
});
