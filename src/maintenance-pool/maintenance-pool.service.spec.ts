import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MaintenancePoolService } from './maintenance-pool.service';
import { EscrowService } from '../escrow/escrow.service';
import { Issue, MaintenancePool } from '../common/entities';
import { AssetType, MaintenancePoolStatus } from '../common/enums';

describe('MaintenancePoolService', () => {
  let service: MaintenancePoolService;
  let poolRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
    increment: jest.Mock;
    decrement: jest.Mock;
  };
  let escrowService: { fund: jest.Mock; poolWithdraw: jest.Mock };
  let issueRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    poolRepo = {
      create: jest.fn((p: Partial<MaintenancePool>) => p),
      save: jest.fn((p: Partial<MaintenancePool>) =>
        Promise.resolve({ id: 'pool-1', ...p }),
      ),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
      decrement: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    escrowService = {
      fund: jest.fn(),
      poolWithdraw: jest.fn(),
    };
    issueRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'issue-1',
        isMaintenanceType: true,
        repositoryId: 'repository-1',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenancePoolService,
        { provide: getRepositoryToken(MaintenancePool), useValue: poolRepo },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
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
      // A stateful row, mutated by `update`/`increment` exactly as the real
      // atomic SQL statements would mutate the Postgres row — lets us assert
      // on the final re-fetched state returned by deposit().
      const row = {
        id: 'pool-1',
        status: MaintenancePoolStatus.ACTIVE,
        balance: '0',
        monthlyDeposit: '500',
        asset: AssetType.USDC,
        escrowId: null as string | null,
      };
      poolRepo.findOne.mockImplementation(() => Promise.resolve(row));
      poolRepo.update.mockImplementation(
        (_id: string, partial: Partial<typeof row>) => {
          Object.assign(row, partial);
          return Promise.resolve({ affected: 1 });
        },
      );
      poolRepo.increment.mockImplementation(
        (_where: { id: string }, column: 'balance', value: number) => {
          row[column] = (Number(row[column]) + value).toFixed(7);
          return Promise.resolve({ affected: 1 });
        },
      );
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
    });

    // #93: monthlyDeposit records the sponsor's standing recurring
    // commitment (set at pool creation), so an ad-hoc deposit must never
    // overwrite it with the latest single deposit amount.
    it('leaves monthlyDeposit untouched by ad-hoc deposits (#93)', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        status: MaintenancePoolStatus.ACTIVE,
        balance: '100',
        monthlyDeposit: '500',
        asset: AssetType.USDC,
        escrowId: 'escrow-1',
      });
      escrowService.fund.mockResolvedValue({
        id: 'escrow-2',
        status: 'locked',
      });

      const pool = await service.deposit('pool-1', '50', 'GFUNDER');

      expect(pool.monthlyDeposit).toBe('500');
    });

    it('accumulates balance across deposits', async () => {
      const row = {
        id: 'pool-1',
        status: MaintenancePoolStatus.ACTIVE,
        balance: '100',
        asset: AssetType.USDC,
        escrowId: 'escrow-1',
      };
      poolRepo.findOne.mockImplementation(() => Promise.resolve(row));
      poolRepo.increment.mockImplementation(
        (_where: { id: string }, column: 'balance', value: number) => {
          row[column] = (Number(row[column]) + value).toFixed(7);
          return Promise.resolve({ affected: 1 });
        },
      );
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

  describe('assignReward', () => {
    it('rejects when the pool has no funded escrow yet', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        balance: '100',
        escrowId: null,
      });

      await expect(
        service.assignReward('pool-1', 'issue-1', '10', 'GRECIPIENT'),
      ).rejects.toThrow(BadRequestException);
      expect(escrowService.poolWithdraw).not.toHaveBeenCalled();
    });

    it('rejects when the requested amount exceeds the pool balance', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        balance: '50',
        escrowId: 'escrow-1',
      });

      await expect(
        service.assignReward('pool-1', 'issue-1', '100', 'GRECIPIENT'),
      ).rejects.toThrow(BadRequestException);
      expect(escrowService.poolWithdraw).not.toHaveBeenCalled();
    });

    it('releases the reward and decrements the balance', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        balance: '100',
        escrowId: 'escrow-1',
      });
      escrowService.poolWithdraw.mockResolvedValue({ id: 'payment-1' });

      const payment = await service.assignReward(
        'pool-1',
        'issue-1',
        '30',
        'GRECIPIENT',
        'user-1',
      );

      expect(escrowService.poolWithdraw).toHaveBeenCalledWith(
        'escrow-1',
        '30',
        'GRECIPIENT',
        'user-1',
      );
      expect(payment).toEqual({ id: 'payment-1' });
      expect(poolRepo.decrement).toHaveBeenCalledWith(
        { id: 'pool-1' },
        'balance',
        30,
      );
    });

    it('rejects a reward for a non-maintenance issue before releasing funds', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        balance: '100',
        escrowId: 'escrow-1',
      });
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-1',
        isMaintenanceType: false,
        repositoryId: 'repository-1',
      });

      await expect(
        service.assignReward('pool-1', 'issue-1', '10', 'GRECIPIENT'),
      ).rejects.toThrow(BadRequestException);
      expect(escrowService.poolWithdraw).not.toHaveBeenCalled();
    });

    it('rejects an issue outside the pool repository', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        repositoryId: 'repository-1',
        balance: '100',
        escrowId: 'escrow-1',
      });
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-1',
        isMaintenanceType: true,
        repositoryId: 'repository-2',
      });

      await expect(
        service.assignReward('pool-1', 'issue-1', '10', 'GRECIPIENT'),
      ).rejects.toThrow(BadRequestException);
      expect(escrowService.poolWithdraw).not.toHaveBeenCalled();
    });

    // Regression test for #51 (MaintenancePool.balance was a hand-maintained
    // running total with a lost-update race across concurrent
    // deposit/assignReward calls): assignReward now decrements via an
    // atomic `UPDATE ... SET balance = balance - $1` (poolRepo.decrement)
    // instead of a read-modify-write save(), so each concurrent call's
    // decrement applies relative to the row's *current* value at write
    // time — not a value cached from an earlier read — and neither
    // decrement is lost.
    it('two concurrent assignReward calls both apply — no lost decrement (#51)', async () => {
      const sharedPoolRow: { balance: string; escrowId: string } = {
        balance: '1000.0000000',
        escrowId: 'escrow-1',
      };
      poolRepo.findOne.mockImplementation(() =>
        Promise.resolve({ id: 'pool-1', ...sharedPoolRow }),
      );
      poolRepo.decrement.mockImplementation(
        (_where: { id: string }, column: 'balance', value: number) => {
          sharedPoolRow[column] = (
            Number(sharedPoolRow[column]) - value
          ).toFixed(7);
          return Promise.resolve({ affected: 1 });
        },
      );
      escrowService.poolWithdraw.mockResolvedValue({ id: 'payment-x' });

      await Promise.all([
        service.assignReward('pool-1', 'issue-1', '100', 'GRECIPIENT_A'),
        service.assignReward('pool-1', 'issue-1', '200', 'GRECIPIENT_B'),
      ]);

      expect(sharedPoolRow.balance).toBe('700.0000000');
    });
  });
});
