import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { EscrowReconciliationScheduler } from './escrow-reconciliation.scheduler';
import { EscrowReconciliationService } from './escrow-reconciliation.service';

describe('EscrowReconciliationScheduler (#849)', () => {
  let scheduler: EscrowReconciliationScheduler;
  let reconciliation: { reconcileAll: jest.Mock };
  let configService: { get: jest.Mock };

  const summary = (overrides = {}) => ({
    examined: 0,
    resolved: 0,
    unresolved: 0,
    skipped: 0,
    ...overrides,
  });

  async function build(dataSource?: unknown) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowReconciliationScheduler,
        { provide: EscrowReconciliationService, useValue: reconciliation },
        { provide: ConfigService, useValue: configService },
        ...(dataSource ? [{ provide: DataSource, useValue: dataSource }] : []),
      ],
    }).compile();
    return module.get(EscrowReconciliationScheduler);
  }

  beforeEach(async () => {
    reconciliation = { reconcileAll: jest.fn().mockResolvedValue(summary()) };
    configService = { get: jest.fn().mockReturnValue({ enabled: true }) };
    scheduler = await build();
  });

  it('runs reconcileAll exactly once', async () => {
    await scheduler.reconcileEscrows();
    expect(reconciliation.reconcileAll).toHaveBeenCalledTimes(1);
  });

  it('logs when rows were resolved or flagged', async () => {
    reconciliation.reconcileAll.mockResolvedValue(
      summary({ examined: 3, resolved: 2, unresolved: 1 }),
    );
    const loggerSpy = jest
      .spyOn(scheduler['logger'], 'log')
      .mockImplementation();

    await scheduler.reconcileEscrows();

    expect(loggerSpy).toHaveBeenCalledWith(
      'Reconciled 2 escrow(s); 1 need manual reconciliation',
    );
  });

  it('does not log a run that changed nothing', async () => {
    const loggerSpy = jest
      .spyOn(scheduler['logger'], 'log')
      .mockImplementation();

    await scheduler.reconcileEscrows();

    expect(loggerSpy).not.toHaveBeenCalled();
  });

  it('skips the run when schedulers are disabled (RUN_SCHEDULERS)', async () => {
    configService.get.mockReturnValue({ enabled: false });

    await scheduler.reconcileEscrows();

    expect(reconciliation.reconcileAll).not.toHaveBeenCalled();
  });

  describe('advisory lock (#784)', () => {
    const runnerFor = (acquired: boolean) => ({
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn((sql: string) =>
        Promise.resolve(
          sql.includes('pg_try_advisory_lock')
            ? [{ acquired }]
            : [{ released: true }],
        ),
      ),
    });

    it('runs under its own lock id and releases it on the same connection', async () => {
      const runner = runnerFor(true);
      scheduler = await build({
        isInitialized: true,
        createQueryRunner: () => runner,
      });

      await scheduler.reconcileEscrows();

      expect(runner.query).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [847293],
      );
      expect(runner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1) AS released',
        [847293],
      );
      expect(runner.release).toHaveBeenCalled();
      expect(reconciliation.reconcileAll).toHaveBeenCalledTimes(1);
    });

    it('skips when another instance holds the lock', async () => {
      scheduler = await build({
        isInitialized: true,
        createQueryRunner: () => runnerFor(false),
      });

      await scheduler.reconcileEscrows();

      expect(reconciliation.reconcileAll).not.toHaveBeenCalled();
    });
  });
});
