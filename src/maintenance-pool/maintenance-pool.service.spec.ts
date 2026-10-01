import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MaintenancePoolService } from './maintenance-pool.service';
import { EscrowService } from '../escrow/escrow.service';
import { Issue, MaintenancePool, Payment } from '../common/entities';
import { AssetType, MaintenancePoolStatus } from '../common/enums';

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
  let poolRepo: any;
  let escrowService: { fund: jest.Mock; poolWithdraw: jest.Mock };
  let issueRepo: { findOne: jest.Mock };
  let paymentRepo: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const activePool = (): Partial<MaintenancePool> => ({
    id: 'pool-1',
    status: MaintenancePoolStatus.ACTIVE,
    escrowId: 'escrow-1',
    asset: AssetType.USDC,
    repositoryId: 'repo-1',
    balance: '500',
  });

  // Minimal poolRepo query builder for assignReward balance update
  function makePoolUpdateQb(affected = 1) {
    return {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected }),
    };
  }

  beforeEach(async () => {
    poolRepo = {
      create: jest.fn((p) => p),
      save: jest.fn((p) => Promise.resolve({ id: 'pool-1', ...p })),
      findOne: jest.fn().mockResolvedValue({ ...activePool() }),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      increment: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(makePoolUpdateQb()),
    };

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

    // Default: no existing payment for the issue
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
        cb(makeManager({ ...activePool(), escrowId: null })),
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
  // #458: assignReward double-payout guard must be keyed on issueId
  // -----------------------------------------------------------------------
  describe('assignReward (#458)', () => {
    it('allows first reward for an issue', async () => {
      // paymentRepo.createQueryBuilder().getOne() returns null => no prior payment
      await expect(
        service.assignReward('pool-1', 'issue-1', '50', 'recv-addr', 'user-1'),
      ).resolves.toBeTruthy();
    });

    it('rejects a second reward for the SAME issue regardless of recipient (#458)', async () => {
      // Simulate: first payment already exists for issue-1 in this pool
      paymentRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'payment-existing', issueId: 'issue-1' }),
      });

      await expect(
        // Different recipient (recipientB) but SAME issue -- must still be blocked
        service.assignReward('pool-1', 'issue-1', '50', 'recv-addr-B', 'user-2'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects double-payout for anonymous (null recipientId) assignments (#458)', async () => {
      paymentRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'anon-payment', issueId: 'issue-1' }),
      });

      await expect(
        service.assignReward('pool-1', 'issue-1', '50', 'recv-addr'),
      ).rejects.toThrow(ConflictException);
    });

    it('guards on issueId in the query (not recipientId) (#458)', async () => {
      const andWhereMock = jest.fn().mockReturnThis();
      paymentRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: andWhereMock,
        getOne: jest.fn().mockResolvedValue(null),
      });

      await service.assignReward('pool-1', 'issue-1', '50', 'recv-addr', 'user-1');

      // Must filter by issueId, not recipientId
      const callArgs = andWhereMock.mock.calls.map((c: any[]) => c[0]);
      const hasIssueFilter = callArgs.some(
        (arg: string) => typeof arg === 'string' && arg.includes('issueId'),
      );
      const hasRecipientFilter = callArgs.some(
        (arg: string) => typeof arg === 'string' && arg.includes('recipientId'),
      );
      expect(hasIssueFilter).toBe(true);
      expect(hasRecipientFilter).toBe(false);
    });

    it('throws BadRequestException when balance is insufficient', async () => {
      poolRepo.createQueryBuilder.mockReturnValue(makePoolUpdateQb(0));
      await expect(
        service.assignReward('pool-1', 'issue-1', '9999', 'recv-addr'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when issue does not exist', async () => {
      issueRepo.findOne.mockResolvedValue(null);
      await expect(
        service.assignReward('pool-1', 'missing-issue', '50', 'addr'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

// Helper for makePoolUpdateQb used in describe block above
function makePoolUpdateQb(affected = 1) {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
}
