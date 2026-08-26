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
  };
  let escrowService: { fund: jest.Mock; releasePartial: jest.Mock };
  let issueRepo: { findOne: jest.Mock };

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
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        status: MaintenancePoolStatus.ACTIVE,
        balance: '0',
        monthlyDeposit: '500',
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
      expect(escrowService.releasePartial).not.toHaveBeenCalled();
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
      expect(escrowService.releasePartial).not.toHaveBeenCalled();
    });

    it('releases the reward and decrements the balance', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        balance: '100',
        escrowId: 'escrow-1',
      });
      escrowService.releasePartial.mockResolvedValue({ id: 'payment-1' });

      const payment = await service.assignReward(
        'pool-1',
        'issue-1',
        '30',
        'GRECIPIENT',
        'user-1',
      );

      expect(escrowService.releasePartial).toHaveBeenCalledWith(
        'escrow-1',
        '30',
        'GRECIPIENT',
        'user-1',
      );
      expect(payment).toEqual({ id: 'payment-1' });
      expect(poolRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ balance: '70.0000000' }),
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
      expect(escrowService.releasePartial).not.toHaveBeenCalled();
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
      expect(escrowService.releasePartial).not.toHaveBeenCalled();
    });

    // Regression baseline for #51 (MaintenancePool.balance is a
    // hand-maintained running total with a lost-update race across
    // concurrent deposit/assignReward calls): reproduces the race
    // deterministically by backing findOne()/save() with a single shared
    // mutable record, matching how the real Postgres row works — both
    // concurrent calls read the same starting balance before either writes
    // back, because assignReward never re-reads or locks the row between
    // its initial findOne() and its final save(). Once #51 lands a fix
    // (e.g. an atomic UPDATE ... SET balance = balance - $1, or a
    // pessimistic lock/transaction around read-modify-write), this test's
    // "loses one of the two decrements" assertion is expected to flip to
    // "balance reflects both decrements".
    it('[current behavior, see #51] two concurrent assignReward calls lose one balance decrement', async () => {
      const sharedPoolRow: { balance: string; escrowId: string } = {
        balance: '1000.0000000',
        escrowId: 'escrow-1',
      };
      poolRepo.findOne.mockImplementation(() =>
        Promise.resolve({ id: 'pool-1', ...sharedPoolRow }),
      );
      poolRepo.save.mockImplementation((pool: { balance: string }) => {
        sharedPoolRow.balance = pool.balance;
        return Promise.resolve(pool);
      });
      escrowService.releasePartial.mockResolvedValue({ id: 'payment-x' });

      await Promise.all([
        service.assignReward('pool-1', 'issue-1', '100', 'GRECIPIENT_A'),
        service.assignReward('pool-1', 'issue-1', '200', 'GRECIPIENT_B'),
      ]);

      // Both concurrent calls read balance=1000 before either wrote back,
      // so whichever save() lands last overwrites the other's decrement —
      // the final balance reflects only ONE of the two rewards, not both.
      // A correct implementation would settle at 1000 - 100 - 200 = 700.
      expect(sharedPoolRow.balance).not.toBe('700.0000000');
      expect(['900.0000000', '800.0000000']).toContain(sharedPoolRow.balance);
    });
  });
});
