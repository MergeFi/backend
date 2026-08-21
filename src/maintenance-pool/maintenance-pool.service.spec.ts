import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

  describe('deposit', () => {
    it('rejects when the pool is not ACTIVE', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        status: MaintenancePoolStatus.PAUSED,
        balance: '0',
      });

      await expect(service.deposit('pool-1', '100', 'GFUNDER')).rejects.toThrow(
        BadRequestException,
      );
      expect(escrowService.fund).not.toHaveBeenCalled();
    });

    it('funds a new escrow and sets escrowId on the first deposit', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        status: MaintenancePoolStatus.ACTIVE,
        balance: '0',
        asset: AssetType.USDC,
        escrowId: null,
      });
      escrowService.fund.mockResolvedValue({
        id: 'escrow-1',
        status: 'locked',
      });

      const pool = await service.deposit('pool-1', '100', 'GFUNDER');

      expect(escrowService.fund).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: '100',
          asset: AssetType.USDC,
          funderAddress: 'GFUNDER',
          maintenancePoolId: 'pool-1',
        }),
      );
      expect(pool.escrowId).toBe('escrow-1');
      expect(pool.balance).toBe('100.0000000');
      expect(pool.monthlyDeposit).toBe('100');
    });

    it('accumulates balance across deposits', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        status: MaintenancePoolStatus.ACTIVE,
        balance: '100',
        asset: AssetType.USDC,
        escrowId: 'escrow-1',
      });
      escrowService.fund.mockResolvedValue({
        id: 'escrow-2',
        status: 'locked',
      });

      const pool = await service.deposit('pool-1', '50', 'GFUNDER');

      expect(pool.balance).toBe('150.0000000');
    });

    // Regression baseline for #48 (MaintenancePoolService.deposit creates a
    // brand-new orphaned Escrow row on every deposit after the first,
    // permanently stranding those funds outside assignReward's reach):
    // documents the current behavior a repeat deposit exhibits today —
    // escrowService.fund() is called again (locking new funds on-chain and
    // creating a second Escrow row), but pool.escrowId is never updated to
    // point at it. assignReward only ever reads pool.escrowId, so this
    // second escrow becomes permanently unreachable through the app. Once
    // #48 lands a fix (e.g. topping up the existing escrow instead of
    // minting a new one, or updating escrowId), this assertion on escrowId
    // staying pinned to the *first* escrow is expected to change.
    it('[current behavior, see #48] a repeat deposit funds a second escrow but leaves escrowId pinned to the first', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        status: MaintenancePoolStatus.ACTIVE,
        balance: '100',
        asset: AssetType.USDC,
        escrowId: 'escrow-1',
      });
      escrowService.fund.mockResolvedValue({
        id: 'escrow-2',
        status: 'locked',
      });

      const pool = await service.deposit('pool-1', '50', 'GFUNDER');

      // The second escrow was funded (real money locked on-chain / a real
      // row created)...
      expect(escrowService.fund).toHaveBeenCalledTimes(1);
      expect(escrowService.fund).toHaveBeenCalledWith(
        expect.objectContaining({ maintenancePoolId: 'pool-1', amount: '50' }),
      );
      // ...but the pool never learns escrow-2 exists. assignReward() can
      // only ever release from pool.escrowId, so escrow-2's funds are
      // unreachable through this service.
      expect(pool.escrowId).toBe('escrow-1');
    });
  });
});
