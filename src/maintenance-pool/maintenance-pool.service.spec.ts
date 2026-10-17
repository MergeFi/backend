import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MaintenancePoolService } from './maintenance-pool.service';
import { EscrowService } from '../escrow/escrow.service';
import { Issue, MaintenancePool, Payment } from '../common/entities';
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
    createQueryBuilder: jest.Mock;
  };
  let escrowService: { fund: jest.Mock; poolWithdraw: jest.Mock; assertPoolWithdrawPreconditions: jest.Mock };
  let issueRepo: { findOne: jest.Mock };
  let paymentRepo: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

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
      createQueryBuilder: jest.fn(),
    };
    escrowService = {
      fund: jest.fn(),
      poolWithdraw: jest.fn(),
      assertPoolWithdrawPreconditions: jest.fn().mockResolvedValue(undefined),
    };
    issueRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'issue-1',
        isMaintenanceType: true,
        repositoryId: 'repository-1',
      }),
    };
    paymentRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenancePoolService,
        { provide: getRepositoryToken(MaintenancePool), useValue: poolRepo },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: EscrowService, useValue: escrowService },
      ],
    }).compile();

    service = module.get(MaintenancePoolService);
  });

  describe('create', () => {
    it('saves a new pool with ACTIVE status', async () => {
      const pool = await service.create(
        { name: 'Docs pool', asset: AssetType.USDC, createdById: 'creator-1' },
        'caller-99',
      );

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

    it('falls back to callerUserId for createdById when client omits it', async () => {
      await service.create({ name: 'Pool', asset: AssetType.USDC }, 'caller-99');

      expect(poolRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryId: null, createdById: 'caller-99' }),
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
    beforeEach(() => {
      // Default mock for deposit's createQueryBuilder (SELECT ... FOR UPDATE)
      const mockDepositQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      };
      poolRepo.createQueryBuilder.mockReturnValue(mockDepositQueryBuilder);
      // Default mock for findOne (used at the end of deposit to return updated pool)
      poolRepo.findOne.mockResolvedValue(null);
    });

    it('rejects when the pool is not ACTIVE', async () => {
      poolRepo.createQueryBuilder().getOne.mockResolvedValue({
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
      poolRepo.createQueryBuilder().getOne.mockResolvedValue(row);
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
      // Mock findOne to return the updated row
      poolRepo.findOne.mockResolvedValue(row);

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
      poolRepo.createQueryBuilder().getOne.mockResolvedValue({
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
      // Mock findOne to return the pool
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        status: MaintenancePoolStatus.ACTIVE,
        balance: '100',
        monthlyDeposit: '500',
        asset: AssetType.USDC,
        escrowId: 'escrow-1',
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
      poolRepo.createQueryBuilder().getOne.mockResolvedValue(row);
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
      // Mock findOne to return the updated row
      poolRepo.findOne.mockResolvedValue(row);

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
      poolRepo.createQueryBuilder().getOne.mockResolvedValue({
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
      // Mock findOne to return the pool
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        status: MaintenancePoolStatus.ACTIVE,
        balance: '100',
        asset: AssetType.USDC,
        escrowId: 'escrow-1',
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
    beforeEach(() => {
      // Default mock for paymentRepo.createQueryBuilder - returns null (no existing payment)
      const mockPaymentQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      paymentRepo.createQueryBuilder.mockReturnValue(mockPaymentQueryBuilder);
    });

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
      // Mock the atomic balance check to return 0 affected rows (balance too low)
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      poolRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await expect(
        service.assignReward('pool-1', 'issue-1', '100', 'GRECIPIENT'),
      ).rejects.toThrow(BadRequestException);
      expect(escrowService.poolWithdraw).not.toHaveBeenCalled();
    });

    it('releases the reward and atomically decrements the balance', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        balance: '100',
        escrowId: 'escrow-1',
        status: MaintenancePoolStatus.ACTIVE,
      });
      // Mock the atomic balance check to succeed
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      poolRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
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
      // Verify the atomic balance check was called
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
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

    it('rejects when the issue has already received a reward from this pool (#273)', async () => {
      poolRepo.findOne.mockResolvedValue({
        id: 'pool-1',
        balance: '100',
        escrowId: 'escrow-1',
        status: MaintenancePoolStatus.ACTIVE,
      });
      // Mock the payment query to return an existing payment
      const mockPaymentQueryBuilder = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing-payment' }),
      };
      paymentRepo.createQueryBuilder.mockReturnValue(mockPaymentQueryBuilder);

      await expect(
        service.assignReward('pool-1', 'issue-1', '10', 'GRECIPIENT', 'user-1'),
      ).rejects.toThrow(ConflictException);
      expect(escrowService.poolWithdraw).not.toHaveBeenCalled();
    });

    // Regression test for #51 (MaintenancePool.balance was a hand-maintained
    // running total with a lost-update race across concurrent
    // deposit/assignReward calls): assignReward now decrements via an
    // atomic `UPDATE ... SET balance = balance - $1 WHERE balance >= $1`
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
        Promise.resolve({ id: 'pool-1', status: MaintenancePoolStatus.ACTIVE, ...sharedPoolRow }),
      );
      // Mock the atomic balance check to succeed for both calls
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      poolRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      escrowService.poolWithdraw.mockResolvedValue({ id: 'payment-x' });

      await Promise.all([
        service.assignReward('pool-1', 'issue-1', '100', 'GRECIPIENT_A'),
        service.assignReward('pool-1', 'issue-1', '200', 'GRECIPIENT_B'),
      ]);

      // Both calls should have succeeded (atomic check passed)
      expect(mockQueryBuilder.execute).toHaveBeenCalledTimes(2);
    });

    // Balance-leak regression tests (#issue): any throw inside poolWithdraw
    // after the balance has been decremented must trigger an increment
    // restoration so the pool's DB balance never drifts below the real
    // on-chain balance.

    describe('balance restoration on poolWithdraw failure', () => {
      let mockQueryBuilder: {
        update: jest.Mock;
        set: jest.Mock;
        where: jest.Mock;
        setParameter: jest.Mock;
        execute: jest.Mock;
      };

      beforeEach(() => {
        poolRepo.findOne.mockResolvedValue({
          id: 'pool-1',
          balance: '100',
          escrowId: 'escrow-1',
          status: MaintenancePoolStatus.ACTIVE,
        });
        mockQueryBuilder = {
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          setParameter: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        poolRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      });

      it('restores pool balance when poolWithdraw throws a Soroban invocation error', async () => {
        const sorobanError = new Error('Soroban simulate failed: insufficient fee');
        escrowService.poolWithdraw.mockRejectedValue(sorobanError);

        await expect(
          service.assignReward('pool-1', 'issue-1', '30', 'GRECIPIENT', 'user-1'),
        ).rejects.toThrow('Soroban simulate failed: insufficient fee');

        // Balance must be restored via increment after the decrement
        expect(poolRepo.increment).toHaveBeenCalledWith(
          { id: 'pool-1' },
          'balance',
          30,
        );
      });

      it('restores pool balance when poolWithdraw throws a paymentRepo.save error', async () => {
        const dbError = new Error('connection terminated unexpectedly');
        escrowService.poolWithdraw.mockRejectedValue(dbError);

        await expect(
          service.assignReward('pool-1', 'issue-1', '50', 'GRECIPIENT'),
        ).rejects.toThrow('connection terminated unexpectedly');

        expect(poolRepo.increment).toHaveBeenCalledWith(
          { id: 'pool-1' },
          'balance',
          50,
        );
      });

      it('restores the exact numeric amount that was decremented', async () => {
        escrowService.poolWithdraw.mockRejectedValue(new Error('tx failed'));

        await expect(
          service.assignReward('pool-1', 'issue-1', '12.5', 'GRECIPIENT'),
        ).rejects.toThrow();

        // Number('12.5') === 12.5 — must match what the decrement used
        expect(poolRepo.increment).toHaveBeenCalledWith(
          { id: 'pool-1' },
          'balance',
          12.5,
        );
      });

      it('does NOT call increment when poolWithdraw succeeds', async () => {
        escrowService.poolWithdraw.mockResolvedValue({ id: 'payment-1' });

        await service.assignReward('pool-1', 'issue-1', '30', 'GRECIPIENT', 'user-1');

        expect(poolRepo.increment).not.toHaveBeenCalled();
      });

      it('rethrows the original poolWithdraw error after restoring balance', async () => {
        const originalError = new BadRequestException('recipient mismatch');
        escrowService.poolWithdraw.mockRejectedValue(originalError);

        const thrown = await service
          .assignReward('pool-1', 'issue-1', '10', 'GRECIPIENT')
          .catch((e) => e);

        // The caller sees the original error, not a wrapped one
        expect(thrown).toBe(originalError);
        // And the balance was still restored
        expect(poolRepo.increment).toHaveBeenCalledWith(
          { id: 'pool-1' },
          'balance',
          10,
        );
      });

      it('does NOT decrement at all when assertPoolWithdrawPreconditions rejects before the decrement', async () => {
        // Cheap pre-decrement validation fires — no balance should be touched
        escrowService.assertPoolWithdrawPreconditions.mockRejectedValue(
          new BadRequestException('recipientAddress does not match Stellar address'),
        );

        await expect(
          service.assignReward('pool-1', 'issue-1', '10', 'GSTALE_ADDRESS', 'user-1'),
        ).rejects.toThrow('recipientAddress does not match Stellar address');

        // The atomic decrement was never attempted
        expect(mockQueryBuilder.execute).not.toHaveBeenCalled();
        // And no restoration increment is needed (nothing was decremented)
        expect(poolRepo.increment).not.toHaveBeenCalled();
      });
    });
  });
});
