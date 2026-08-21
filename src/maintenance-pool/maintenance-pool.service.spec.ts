import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { MaintenancePoolService } from './maintenance-pool.service';
import { EscrowService } from '../escrow/escrow.service';
import { MaintenancePool } from '../common/entities';
import { AssetType, MaintenancePoolStatus } from '../common/enums';

describe('MaintenancePoolService', () => {
  let service: MaintenancePoolService;
  let poolRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
  };
  let escrowService: { fund: jest.Mock; releasePartial: jest.Mock };

  beforeEach(async () => {
    poolRepo = {
      create: jest.fn((p: Partial<MaintenancePool>) => p),
      save: jest.fn((p: Partial<MaintenancePool>) =>
        Promise.resolve({ id: 'pool-1', ...p }),
      ),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    escrowService = {
      fund: jest.fn(),
      releasePartial: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenancePoolService,
        { provide: getRepositoryToken(MaintenancePool), useValue: poolRepo },
        { provide: EscrowService, useValue: escrowService },
      ],
    }).compile();

    service = module.get(MaintenancePoolService);
  });

  describe('create', () => {
    it('saves a new pool with ACTIVE status', async () => {
      const pool = await service.create({
        name: 'Docs pool',
        asset: AssetType.USDC,
        createdById: 'creator-1',
      });

      expect(poolRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Docs pool',
          asset: AssetType.USDC,
          createdById: 'creator-1',
          status: MaintenancePoolStatus.ACTIVE,
        }),
      );
      expect(pool.status).toBe(MaintenancePoolStatus.ACTIVE);
    });

    it('defaults repositoryId/createdById to null when not provided', async () => {
      await service.create({ name: 'Pool', asset: AssetType.USDC });

      expect(poolRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryId: null, createdById: null }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the pool does not exist', async () => {
      poolRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('returns every pool', async () => {
      poolRepo.find.mockResolvedValue([{ id: 'pool-1' }, { id: 'pool-2' }]);
      await expect(service.list()).resolves.toHaveLength(2);
    });
  });
});
