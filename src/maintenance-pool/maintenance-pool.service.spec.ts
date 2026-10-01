import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { MaintenancePoolService } from './maintenance-pool.service';
import { EscrowService } from '../escrow/escrow.service';
import { Issue, MaintenancePool, Payment } from '../common/entities';
import { AssetType, MaintenancePoolStatus } from '../common/enums';

/** Builds a minimal EntityManager stub for dataSource.transaction() callbacks. */
function makeManager(pool: Partial<MaintenancePool> | null) {
  const qb = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(pool),
  };
  return {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    increment: jest.fn().mockResolvedValue(undefined),
    findOneByOrFail: jest.fn().mockResolvedValue({ id: 'pool-1', ...pool }),
    _qb: qb,
  };
}

describe('MaintenancePoolService', () => {
  let service: MaintenancePoolService;
  let poolRepo: jest.Mocked<{
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
    increment: jest.Mock;
    createQueryBuilder: jest.Mock;
  }>;
  let escrowService: { fund: jest.Mock; poolWithdraw: jest.Mock };
  let issueRepo: { findOne: jest.Mock };
  let paymentRepo: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const activePool = (): Partial<MaintenancePool> => ({
    id: 'pool-1',
    status: MaintenancePoolStatus.ACTIVE,
    escrowId: null as any,
    asset: AssetType.USDC,
    repositoryId: null,
    balance: '0',
  });

  beforeEach(async () => {
    poolRepo = {
      create: jest.fn((p) => p),
      save: jest.fn((p) => Promise.resolve({ id: 'pool-1', ...p })),
      findOne: jest.fn().mockResolvedValue({ id: 'pool-1', ...activePool() }),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      increment: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
    } as any;

    escrowService = {
      fund: jest.fn().mockResolvedValue({ id: 'escrow-1' }),
      poolWithdraw: jest.fn().mockResolvedValue({ id: 'payment-1' }),
    };

    issueRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'issue-1',
        isMaintenanceType: true,
        repositoryId: 'repo-1',
      }),
    };

    paymentRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      }),
    };

    dataSource = {
      transaction: jest.fn((cb: (mgr: any) => Promise<any>) =>
        cb(makeManager(activePool())),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenancePoolService,
        { provide: getRepositoryToken(MaintenancePool), useValue: poolRepo },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: EscrowService, useValue: escrowService },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get(MaintenancePoolService);
  });

  // -----------------------------------------------------------------------
  // #457: deposit() MUST execute inside a dataSource.transaction()
  // so that the SELECT ... FOR UPDATE has an active QueryRunner and TypeORM
  // does not throw PessimisticLockTransactionRequiredError.
  // -----------------------------------------------------------------------
  describe('deposit (#457)', () => {
    it('wraps deposit() in dataSource.transaction()', async () => {
      await service.deposit('pool-1', '100', 'funder-addr');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('issues SELECT ... FOR UPDATE (pessimistic_write) on the manager QueryBuilder', async () => {
      let capturedManager: any;
      dataSource.transaction.mockImplementation((cb: (mgr: any) => any) => {
        capturedManager = makeManager(activePool());
        return cb(capturedManager);
      });
      await service.deposit('pool-1', '100', 'funder-addr');
      expect(capturedManager._qb.setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('throws NotFoundException when pool is not found inside the transaction', async () => {
      dataSource.transaction.mockImplementation((cb: (mgr: any) => any) =>
        cb(makeManager(null)),
      );
      await expect(service.deposit('missing', '100', 'addr')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException for a non-ACTIVE pool', async () => {
      dataSource.transaction.mockImplementation((cb: (mgr: any) => any) =>
        cb(makeManager({ ...activePool(), status: 'CLOSED' as any })),
      );
      await expect(service.deposit('pool-1', '100', 'addr')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('calls escrowService.fund on first deposit (escrowId is null)', async () => {
      await service.deposit('pool-1', '100', 'funder-addr');
      expect(escrowService.fund).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '100', maintenancePoolId: 'pool-1' }),
      );
    });
  });

  describe('create', () => {
    it('saves a new pool with ACTIVE status', async () => {
      await service.create({ name: 'Docs pool', asset: AssetType.USDC, createdById: 'u1' }, 'caller');
      expect(poolRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: MaintenancePoolStatus.ACTIVE }),
      );
    });

    it('falls back to callerUserId when createdById is omitted', async () => {
      await service.create({ name: 'Pool', asset: AssetType.USDC }, 'caller-99');
      expect(poolRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ createdById: 'caller-99' }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a missing pool', async () => {
      poolRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('returns all pools', async () => {
      poolRepo.find.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as any);
      await expect(service.list()).resolves.toHaveLength(2);
    });
  });
});
