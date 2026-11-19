import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { entities } from '../common/entities/typeorm-entities';
import { Escrow, Payment, User } from '../common/entities';
import { AssetType, EscrowStatus } from '../common/enums';
import { EscrowService } from './escrow.service';
import {
  ContractInvocationResult,
  SorobanClientService,
} from './soroban-client.service';

const SCHEMA = 'escrow_lock_itest';

/**
 * How long the first invocation is held open waiting for a second one to
 * arrive. Long enough that, without the row lock, the second request's
 * read-check-invoke reliably reaches `invoke` inside the window; with the
 * lock it is simply the time the second request spends blocked.
 */
const OVERLAP_WINDOW_MS = 750;

/**
 * Integration test for #844: `EscrowService.withLockedEscrow`'s
 * `SELECT ... FOR UPDATE` is the only thing preventing a double payout when
 * the Soroban client is in dry-run (every environment this suite runs in),
 * because the dry-run `invoke` succeeds unconditionally. escrow.service.spec
 * mocks the repository, so it can only check that `lock: { mode:
 * 'pessimistic_write' }` is *passed*, not that it serialises anything — this
 * file runs two real concurrent transactions against Postgres instead.
 *
 * The Soroban stub mimics dry-run (always succeeds) but holds each call open
 * until either a second call arrives or OVERLAP_WINDOW_MS elapses. That
 * forces maximum overlap: without the lock both requests read LOCKED, both
 * reach `invoke`, release each other, and both record a Payment — so the
 * assertions below fail on a regression rather than passing by timing luck.
 *
 * Isolated in its own schema so it can run alongside the other integration
 * specs without dropSchema races (same approach as analytics.integration.spec).
 */
describe('EscrowService row-lock serialisation (integration, #844)', () => {
  let dataSource: DataSource;
  let escrowRepo: Repository<Escrow>;
  let paymentRepo: Repository<Payment>;
  let service: EscrowService;
  let invocations: string[];
  let dbAvailable = false;

  /** Dry-run-like stub that holds the call open to force concurrent overlap. */
  function createOverlappingSoroban(): SorobanClientService {
    let waiters: Array<() => void> = [];
    return {
      invoke: async (method: string): Promise<ContractInvocationResult> => {
        invocations.push(method);
        const arrived = new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
        if (waiters.length >= 2) {
          // A second concurrent invocation got through — release both.
          waiters.forEach((wake) => wake());
          waiters = [];
        }
        await Promise.race([
          arrived,
          new Promise((resolve) => setTimeout(resolve, OVERLAP_WINDOW_MS)),
        ]);
        waiters = [];
        return {
          txHash: `dry-run-${method}-${invocations.length}`,
          ledger: null,
          returnValue: null,
          status: 'DRY_RUN',
        };
      },
    } as unknown as SorobanClientService;
  }

  beforeAll(async () => {
    const url =
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/mergefi';

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities,
      synchronize: true,
      dropSchema: true,
    });
    try {
      // dropSchema/synchronize work inside an existing schema but don't
      // create it — see analytics.integration.spec.ts.
      const bootstrap = new DataSource({ type: 'postgres', url });
      await bootstrap.initialize();
      await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
      await bootstrap.destroy();

      await dataSource.initialize();
    } catch (err) {
      console.warn(
        'Skipping escrow lock integration tests: Postgres is not reachable at DATABASE_URL.',
        err,
      );
      return;
    }
    dbAvailable = true;

    escrowRepo = dataSource.getRepository(Escrow);
    paymentRepo = dataSource.getRepository(Payment);
  }, 30_000);

  beforeEach(() => {
    invocations = [];
    if (!dbAvailable) return;
    service = new EscrowService(
      escrowRepo,
      paymentRepo,
      dataSource.getRepository(User),
      dataSource,
      createOverlappingSoroban(),
    );
  });

  afterEach(async () => {
    if (!dbAvailable) return;
    // Query builder rather than raw SQL so the deletes target SCHEMA, not
    // whatever `public` tables the connection's search_path resolves to.
    await paymentRepo.createQueryBuilder().delete().execute();
    await escrowRepo.createQueryBuilder().delete().execute();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function makeLockedEscrow(amount: string): Promise<Escrow> {
    return escrowRepo.save(
      escrowRepo.create({
        amount,
        asset: AssetType.USDC,
        status: EscrowStatus.LOCKED,
      }),
    );
  }

  it('lets exactly one of two concurrent releases pay out; the other sees a non-LOCKED escrow', async () => {
    if (!dbAvailable) {
      expect(process.env.CI).not.toBe('true');
      return;
    }
    const escrow = await makeLockedEscrow('100');

    const outcomes = await Promise.allSettled([
      service.release(escrow.id, 'GRECIPIENTA'),
      service.release(escrow.id, 'GRECIPIENTB'),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
    expect((rejected[0].reason as Error).message).toMatch(
      /is not in LOCKED state \(current: released\)/,
    );

    // The contract was only asked once: the second request was rejected
    // under the lock before ever reaching invoke().
    expect(invocations).toEqual(['release']);

    const payments = await paymentRepo.find({
      where: { escrowId: escrow.id },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe('100.0000000');

    const reloaded = await escrowRepo.findOneByOrFail({ id: escrow.id });
    expect(reloaded.status).toBe(EscrowStatus.RELEASED);
  }, 15_000);

  it('does not let two concurrent partial releases together overshoot the escrow balance', async () => {
    if (!dbAvailable) {
      expect(process.env.CI).not.toBe('true');
      return;
    }
    const escrow = await makeLockedEscrow('100');

    // Each fits on its own (60 <= 100) but together they would pay out 120.
    const outcomes = await Promise.allSettled([
      service.releasePartial(escrow.id, '60', 'GRECIPIENTA'),
      service.releasePartial(escrow.id, '60', 'GRECIPIENTB'),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
    expect((rejected[0].reason as Error).message).toMatch(
      /would exceed remaining escrow balance/,
    );
    expect(invocations).toEqual(['release_partial']);

    const payments = await paymentRepo.find({
      where: { escrowId: escrow.id },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe('60.0000000');

    // 60 of 100 released: still open for further partial releases.
    const reloaded = await escrowRepo.findOneByOrFail({ id: escrow.id });
    expect(reloaded.status).toBe(EscrowStatus.LOCKED);
  }, 15_000);
});
