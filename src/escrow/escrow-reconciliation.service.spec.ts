import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Escrow, Payment } from '../common/entities';
import { AssetType, EscrowStatus } from '../common/enums';
import {
  EscrowReconciliationService,
  parseOnChainEscrow,
} from './escrow-reconciliation.service';
import {
  SOROBAN_TX_TIMEOUT_SECONDS,
  SorobanClientService,
  u64,
} from './soroban-client.service';

describe('EscrowReconciliationService (#849)', () => {
  let service: EscrowReconciliationService;
  let candidates: Escrow[];
  let rows: Map<string, Escrow>;
  let payments: Partial<Payment>[];
  let queryBuilder: Record<string, jest.Mock>;
  let escrowRepo: { createQueryBuilder: jest.Mock; count: jest.Mock };
  let manager: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let soroban: {
    isConfigured: jest.Mock;
    getTransaction: jest.Mock;
    read: jest.Mock;
  };

  const escrow = (overrides: Partial<Escrow> = {}): Escrow =>
    ({
      id: 'escrow-1',
      bountyId: 'bounty-1',
      milestoneId: null,
      maintenancePoolId: null,
      contractId: 'CESCROW',
      onChainId: '4242',
      amount: '100.0000000',
      asset: AssetType.USDC,
      status: EscrowStatus.LOCKED,
      fundTxHash: null,
      releaseTxHash: null,
      refundTxHash: null,
      lockedAt: null,
      releasedAt: null,
      refundedAt: null,
      metadata: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as Escrow;

  /** Seeds the batch; the locked re-read returns an independent copy. */
  const seed = (...escrows: Escrow[]) => {
    candidates = escrows;
    rows = new Map(
      escrows.map((e) => [e.id, structuredClone(e)] as [string, Escrow]),
    );
  };

  const saved = (): Escrow => {
    const calls = manager.save.mock.calls as [unknown, Escrow][];
    return calls[calls.length - 1][1];
  };

  const pendingSince = (msAgo: number) => ({
    pending: {
      txHash: 'tx-pending',
      at: new Date(Date.now() - msAgo).toISOString(),
    },
  });

  const expiredMs = SOROBAN_TX_TIMEOUT_SECONDS * 1000 + 5 * 60_000;

  beforeEach(async () => {
    candidates = [];
    rows = new Map();
    payments = [];
    queryBuilder = {};
    for (const method of ['where', 'orWhere', 'orderBy', 'take']) {
      queryBuilder[method] = jest.fn(() => queryBuilder);
    }
    queryBuilder.getMany = jest.fn(() => Promise.resolve(candidates));
    escrowRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      count: jest.fn().mockResolvedValue(0),
    };
    manager = {
      findOne: jest.fn((_entity: unknown, opts: { where: { id: string } }) =>
        Promise.resolve(rows.get(opts.where.id) ?? null),
      ),
      find: jest.fn(() => Promise.resolve(payments)),
      save: jest.fn((_entity: unknown, data: Escrow) => Promise.resolve(data)),
    };
    soroban = {
      isConfigured: jest.fn().mockReturnValue(true),
      getTransaction: jest.fn(),
      read: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowReconciliationService,
        { provide: getRepositoryToken(Escrow), useValue: escrowRepo },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((fn: (m: typeof manager) => unknown) =>
              fn(manager),
            ),
          },
        },
        { provide: SorobanClientService, useValue: soroban },
      ],
    }).compile();

    service = module.get(EscrowReconciliationService);
  });

  it('does nothing in dry-run, where no chain exists to reconcile against', async () => {
    soroban.isConfigured.mockReturnValue(false);

    const summary = await service.reconcileAll();

    expect(summary.examined).toBe(0);
    expect(escrowRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('selects pending-with-hash, locked-with-lastFailure, and flagged/diverged rows', async () => {
    await service.reconcileAll();

    const clauses = [
      ...queryBuilder.where.mock.calls,
      ...queryBuilder.orWhere.mock.calls,
    ].map(([sql]) => sql as string);
    expect(clauses.join('\n')).toEqual(
      expect.stringContaining(`metadata -> 'pending' ->> 'txHash'`),
    );
    expect(clauses.join('\n')).toEqual(
      expect.stringContaining(`metadata -> 'lastFailure'`),
    );
    expect(clauses.join('\n')).toEqual(
      expect.stringContaining(`'reconciliation' ->> 'resolved' = 'false'`),
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      'escrow.updatedAt',
      'ASC',
    );
  });

  describe('PENDING with metadata.pending.txHash', () => {
    it('settles to LOCKED when getTransaction reports SUCCESS', async () => {
      seed(
        escrow({ status: EscrowStatus.PENDING, metadata: pendingSince(1000) }),
      );
      soroban.getTransaction.mockResolvedValue({
        status: 'SUCCESS',
        ledger: 99,
        returnValue: null,
      });

      const summary = await service.reconcileAll();

      expect(soroban.getTransaction).toHaveBeenCalledWith('tx-pending');
      expect(summary).toEqual(
        expect.objectContaining({ examined: 1, resolved: 1 }),
      );
      const row = saved();
      expect(row.status).toBe(EscrowStatus.LOCKED);
      expect(row.fundTxHash).toBe('tx-pending');
      expect(row.lockedAt).toBeInstanceOf(Date);
      expect(row.metadata).not.toHaveProperty('pending');
      expect(row.metadata).toEqual(
        expect.objectContaining({
          fund: expect.objectContaining({ txHash: 'tx-pending', ledger: 99 }),
          reconciliation: expect.objectContaining({ resolved: true }),
        }),
      );
    });

    it('settles to FAILED when the transaction was included and failed', async () => {
      seed(
        escrow({ status: EscrowStatus.PENDING, metadata: pendingSince(1000) }),
      );
      soroban.getTransaction.mockResolvedValue({
        status: 'FAILED',
        ledger: 99,
        returnValue: null,
      });

      await service.reconcileAll();

      const row = saved();
      expect(row.status).toBe(EscrowStatus.FAILED);
      expect(row.metadata).not.toHaveProperty('pending');
      expect(row.metadata?.error).toEqual(
        expect.stringContaining('tx-pending'),
      );
    });

    it('waits while a NOT_FOUND hash is still inside its time bound', async () => {
      seed(
        escrow({ status: EscrowStatus.PENDING, metadata: pendingSince(1000) }),
      );
      soroban.getTransaction.mockResolvedValue({
        status: 'NOT_FOUND',
        ledger: null,
        returnValue: null,
      });

      const summary = await service.reconcileAll();

      expect(summary.skipped).toBe(1);
      expect(soroban.read).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('marks FAILED once an expired NOT_FOUND hash has no on-chain escrow record', async () => {
      seed(
        escrow({
          status: EscrowStatus.PENDING,
          metadata: pendingSince(expiredMs),
        }),
      );
      soroban.getTransaction.mockResolvedValue({
        status: 'NOT_FOUND',
        ledger: null,
        returnValue: null,
      });
      soroban.read.mockResolvedValue(null);

      await service.reconcileAll();

      expect(soroban.read).toHaveBeenCalledWith('get_escrow', [u64('4242')], {
        contractId: 'CESCROW',
      });
      expect(saved().status).toBe(EscrowStatus.FAILED);
    });

    it('marks LOCKED when an expired hash was pruned but the contract holds the escrow', async () => {
      seed(
        escrow({
          status: EscrowStatus.PENDING,
          metadata: pendingSince(expiredMs),
        }),
      );
      soroban.getTransaction.mockResolvedValue({
        status: 'NOT_FOUND',
        ledger: null,
        returnValue: null,
      });
      soroban.read.mockResolvedValue({ status: ['Locked'], amount: 1n });

      await service.reconcileAll();

      expect(saved().status).toBe(EscrowStatus.LOCKED);
      expect(saved().fundTxHash).toBe('tx-pending');
    });

    it('flags instead of guessing when another row shares the on-chain id', async () => {
      seed(
        escrow({
          status: EscrowStatus.PENDING,
          metadata: pendingSince(expiredMs),
        }),
      );
      soroban.getTransaction.mockResolvedValue({
        status: 'NOT_FOUND',
        ledger: null,
        returnValue: null,
      });
      soroban.read.mockResolvedValue({ status: ['Locked'] });
      escrowRepo.count.mockResolvedValue(1);

      const summary = await service.reconcileAll();

      expect(summary.unresolved).toBe(1);
      const row = saved();
      expect(row.status).toBe(EscrowStatus.PENDING);
      expect(row.metadata).toHaveProperty('pending');
      expect(row.metadata?.reconciliation).toEqual(
        expect.objectContaining({
          resolved: false,
          reason: expect.any(String),
        }),
      );
    });
  });

  describe('LOCKED with metadata.lastFailure', () => {
    const failure = {
      lastFailure: { operation: 'release', error: 'timeout', at: 'x' },
    };

    it('keeps LOCKED and clears the failure when the contract still holds the funds', async () => {
      seed(escrow({ metadata: failure }));
      soroban.read.mockResolvedValue({ status: 'Locked' });

      const summary = await service.reconcileAll();

      expect(summary.resolved).toBe(1);
      const row = saved();
      expect(row.status).toBe(EscrowStatus.LOCKED);
      expect(row.metadata).not.toHaveProperty('lastFailure');
      expect(row.metadata?.reconciliation).toEqual(
        expect.objectContaining({
          resolved: true,
          clearedFailure: failure.lastFailure,
        }),
      );
    });

    it('settles to REFUNDED when the refund executed on-chain', async () => {
      seed(escrow({ metadata: failure }));
      soroban.read.mockResolvedValue({ status: ['Refunded'] });

      await service.reconcileAll();

      expect(saved().status).toBe(EscrowStatus.REFUNDED);
      expect(saved().refundedAt).toBeInstanceOf(Date);
    });

    it('settles to RELEASED when the release executed and payments cover the total', async () => {
      seed(escrow({ metadata: failure }));
      payments = [{ amount: '100.0000000' }];
      soroban.read.mockResolvedValue({
        status: ['Released'],
        amount: 1_000_000_000n,
      });

      await service.reconcileAll();

      expect(saved().status).toBe(EscrowStatus.RELEASED);
    });

    it('flags RECONCILIATION_PENDING rather than inventing Payment rows for an unrecorded release', async () => {
      seed(escrow({ metadata: failure }));
      soroban.read.mockResolvedValue({ status: ['Released'] });

      const summary = await service.reconcileAll();

      expect(summary.unresolved).toBe(1);
      const row = saved();
      // LOCKED would let a second release run against a settled escrow.
      expect(row.status).toBe(EscrowStatus.RECONCILIATION_PENDING);
      expect(row.metadata?.lastFailure).toEqual(failure.lastFailure);
      expect(row.metadata?.reconciliation).toEqual(
        expect.objectContaining({
          resolved: false,
          onChainStatus: 'released',
          reason: expect.stringContaining('payments'),
          checkedAt: expect.any(String),
        }),
      );
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.save).not.toHaveBeenCalledWith(Payment, expect.anything());
    });

    it('flags a row with no on-chain record', async () => {
      seed(escrow({ metadata: failure }));
      soroban.read.mockResolvedValue(null);

      await service.reconcileAll();

      expect(saved().status).toBe(EscrowStatus.LOCKED);
      expect(saved().metadata?.reconciliation).toEqual(
        expect.objectContaining({ resolved: false }),
      );
    });

    it('flags maintenance-pool rows without reading get_escrow', async () => {
      seed(escrow({ maintenancePoolId: 'pool-1', metadata: failure }));

      const summary = await service.reconcileAll();

      expect(soroban.read).not.toHaveBeenCalled();
      expect(summary.unresolved).toBe(1);
    });
  });

  describe('RELEASED divergence (#814)', () => {
    const diverged = {
      reconciliation: {
        divergedAt: 'x',
        returnedStroops: '999',
        recordedStroops: '1000000000',
        resolved: false,
      },
    };

    it('resolves to RELEASED once the on-chain amount matches the recorded payments', async () => {
      seed(
        escrow({
          status: EscrowStatus.RECONCILIATION_PENDING,
          metadata: diverged,
        }),
      );
      payments = [{ amount: '60.0000000' }, { amount: '40.0000000' }];
      soroban.read.mockResolvedValue({
        status: ['Released'],
        amount: 1_000_000_000n,
      });

      await service.reconcileAll();

      const row = saved();
      expect(row.status).toBe(EscrowStatus.RELEASED);
      expect(row.metadata?.reconciliation).toEqual(
        expect.objectContaining({
          resolved: true,
          returnedStroops: '999',
          resolvedAt: expect.any(String),
        }),
      );
    });

    it('keeps the divergence flagged when the record does not report an amount', async () => {
      seed(
        escrow({
          status: EscrowStatus.RECONCILIATION_PENDING,
          metadata: diverged,
        }),
      );
      payments = [{ amount: '100.0000000' }];
      soroban.read.mockResolvedValue({ status: ['Released'] });

      await service.reconcileAll();

      expect(saved().status).toBe(EscrowStatus.RECONCILIATION_PENDING);
      expect(saved().metadata?.reconciliation).toEqual(
        expect.objectContaining({ resolved: false }),
      );
    });
  });

  it('skips a row that changed between the chain read and the row lock', async () => {
    seed(escrow({ metadata: { lastFailure: { operation: 'refund' } } }));
    rows.get('escrow-1')!.status = EscrowStatus.REFUNDED;
    soroban.read.mockResolvedValue({ status: ['Refunded'] });

    const summary = await service.reconcileAll();

    expect(summary.skipped).toBe(1);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('takes a pessimistic row lock before writing', async () => {
    seed(escrow({ metadata: { lastFailure: { operation: 'refund' } } }));
    soroban.read.mockResolvedValue({ status: ['Locked'] });

    await service.reconcileAll();

    expect(manager.findOne).toHaveBeenCalledWith(Escrow, {
      where: { id: 'escrow-1' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('continues the batch when one row throws', async () => {
    seed(
      escrow({ id: 'a', metadata: { lastFailure: {} } }),
      escrow({ id: 'b', metadata: { lastFailure: {} } }),
    );
    soroban.read
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValueOnce({ status: ['Locked'] });

    const summary = await service.reconcileAll();

    expect(summary).toEqual({
      examined: 2,
      resolved: 1,
      unresolved: 0,
      skipped: 1,
    });
  });

  it('findUnresolved queries the metadata.reconciliation.resolved flag', async () => {
    await service.findUnresolved();

    expect(queryBuilder.where).toHaveBeenCalledWith(
      `escrow.metadata -> 'reconciliation' ->> 'resolved' = 'false'`,
    );
  });
});

describe('parseOnChainEscrow', () => {
  it('returns null for an absent record (Option::None)', () => {
    expect(parseOnChainEscrow(null)).toBeNull();
    expect(parseOnChainEscrow(undefined)).toBeNull();
  });

  it.each([
    [['Locked'], 'locked'],
    ['released', 'released'],
    [['Refunded'], 'refunded'],
    ['Bogus', 'unknown'],
  ])('normalises status %p to %p', (status, expected) => {
    expect(parseOnChainEscrow({ status })?.status).toBe(expected);
  });

  it('decodes amounts from bigint, number, or numeric string', () => {
    expect(
      parseOnChainEscrow({ status: 'Locked', amount: 5n, released: '3' }),
    ).toEqual({ status: 'locked', amount: 5n, released: 3n });
    expect(parseOnChainEscrow({ status: 'Locked', amount: 7 })?.amount).toBe(
      7n,
    );
  });
});
