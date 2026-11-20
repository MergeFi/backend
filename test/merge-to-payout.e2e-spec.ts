import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Keypair } from '@stellar/stellar-sdk';
import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AnalyticsModule } from '../src/analytics/analytics.module';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { BountiesModule } from '../src/bounties/bounties.module';
import { BountiesService } from '../src/bounties/bounties.service';
import {
  Bounty,
  Escrow,
  Issue,
  Payment,
  Repository as RepositoryEntity,
  Team,
  TeamMemberSplit,
  User,
  WebhookEvent,
} from '../src/common/entities';
import {
  AssetType,
  BountyStatus,
  EscrowStatus,
  PaymentStatus,
  WebhookEventStatus,
} from '../src/common/enums';
import { entities } from '../src/common/entities/typeorm-entities';
import { IdempotencyModule } from '../src/common/idempotency/idempotency.module';
import configuration from '../src/config/configuration';
import { amountToStroops } from '../src/common/validators/money.validator';
import { GithubModule } from '../src/github/github.module';

const SCHEMA = 'merge_to_payout_e2e';
const WEBHOOK_SECRET = 'merge-to-payout-e2e-secret';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/mergefi';

/**
 * The whole merge-to-payout chain, end to end (#848):
 *
 *   signed pull_request.closed(merged) delivery
 *     -> GithubWebhooksController signature gate
 *     -> GithubWebhooksService dispatch
 *     -> BountiesService.markMergedAndRelease
 *     -> EscrowService.release / splitRelease
 *     -> Payment rows, bounty PAID
 *     -> analytics platform-summary invalidation
 *
 * Every link has a unit spec with mocked collaborators; the defects that
 * live at the joins (escrow vs bounty status committing apart, a team with no
 * splits marked PAID, payment amounts drifting from the escrow) are only
 * visible with the real modules wired to a real database, which is what this
 * file does. Soroban is explicitly configured for dry-run in this test so
 * synthetic ledger entries cannot be mistaken for settled payouts.
 *
 * Isolated in its own schema so it can run alongside the other Postgres
 * specs without schema races (same approach as escrow-lock.integration).
 */
describe('Merge-to-payout (e2e, #848)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let bounties: BountiesService;
  let analytics: AnalyticsService;
  let userRepo: Repository<User>;
  let repositoryRepo: Repository<RepositoryEntity>;
  let issueRepo: Repository<Issue>;
  let bountyRepo: Repository<Bounty>;
  let escrowRepo: Repository<Escrow>;
  let paymentRepo: Repository<Payment>;
  let teamRepo: Repository<Team>;
  let webhookEventRepo: Repository<WebhookEvent>;
  let dbAvailable = false;

  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // configuration() reads process.env when ConfigModule loads it. Pin the
    // webhook secret, and make sure no real contract is targeted: the
    // Soroban client must dry-run here.
    for (const key of [
      'GITHUB_WEBHOOK_SECRET',
      'ESCROW_CONTRACT_ID',
      'TREASURY_SECRET',
      'SOROBAN_DRY_RUN',
      'SOROBAN_FEE_BPS',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
    delete process.env.ESCROW_CONTRACT_ID;
    delete process.env.TREASURY_SECRET;
    process.env.SOROBAN_DRY_RUN = 'true';
    process.env.SOROBAN_FEE_BPS = '250';

    try {
      // Start from an empty schema every run; the migrations below build it.
      const bootstrap = new DataSource({ type: 'postgres', url: DATABASE_URL });
      await bootstrap.initialize();
      await bootstrap.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await bootstrap.query(`CREATE SCHEMA ${SCHEMA}`);
      await bootstrap.destroy();
    } catch (err) {
      console.warn(
        'Skipping merge-to-payout e2e: Postgres is not reachable at DATABASE_URL.',
        err,
      );
      return;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        EventEmitterModule.forRoot(),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: DATABASE_URL,
          schema: SCHEMA,
          entities,
          // The schema under test is the one the migrations produce, not one
          // derived from the entities by `synchronize` (#830) — so the DB
          // constraints production relies on (e.g. the split-sum triggers,
          // #836) are in force here too. The migrations are plain SQL, so
          // search_path points their unqualified names at SCHEMA.
          migrations: [__dirname + '/../src/database/migrations/*.ts'],
          migrationsRun: true,
          extra: { options: `-c search_path=${SCHEMA},public` },
        }),
        IdempotencyModule,
        GithubModule,
        BountiesModule,
        AnalyticsModule,
      ],
    }).compile();

    // rawBody: true, as main.ts sets it — the signature is an HMAC over the
    // exact bytes received.
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useLogger(false);
    await app.init();
    dbAvailable = true;

    dataSource = moduleFixture.get(DataSource);
    bounties = moduleFixture.get(BountiesService);
    analytics = moduleFixture.get(AnalyticsService);
    userRepo = dataSource.getRepository(User);
    repositoryRepo = dataSource.getRepository(RepositoryEntity);
    issueRepo = dataSource.getRepository(Issue);
    bountyRepo = dataSource.getRepository(Bounty);
    escrowRepo = dataSource.getRepository(Escrow);
    paymentRepo = dataSource.getRepository(Payment);
    teamRepo = dataSource.getRepository(Team);
    webhookEventRepo = dataSource.getRepository(WebhookEvent);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // ── Seeding ──────────────────────────────────────────────────────────────

  let seq = 0;
  const nextId = () => `${Date.now()}${++seq}`;

  async function seedUser(username: string): Promise<User> {
    return userRepo.save(
      userRepo.create({
        username: `${username}-${nextId()}`,
        stellarAddress: Keypair.random().publicKey(),
      }),
    );
  }

  async function seedRepository(): Promise<RepositoryEntity> {
    const id = nextId();
    return repositoryRepo.save(
      repositoryRepo.create({
        githubRepoId: id,
        owner: 'mergefi',
        name: `payout-${id}`,
        fullName: `mergefi/payout-${id}`,
      }),
    );
  }

  async function seedIssue(
    repository: RepositoryEntity,
    number: number,
  ): Promise<Issue> {
    return issueRepo.save(
      issueRepo.create({
        repositoryId: repository.id,
        githubIssueId: nextId(),
        number,
        title: `Bounty issue #${number}`,
        githubUrl: `https://github.com/${repository.fullName}/issues/${number}`,
      }),
    );
  }

  /**
   * An OPEN bounty funded by the sponsor through the real BountiesService
   * (so the escrow row is the one EscrowService.fund writes) and claimed by
   * the contributor: the state a bounty is in when its PR merges.
   */
  async function seedFundedClaimedBounty(
    issue: Issue,
    sponsor: User,
    contributor: User,
    amount: string,
  ): Promise<Bounty> {
    const created = await bounties.create(
      {
        issueId: issue.id,
        sponsorId: sponsor.id,
        amount,
        asset: AssetType.USDC,
      },
      sponsor.id,
    );
    await bounties.fund(created.id, sponsor.stellarAddress!, sponsor.id);
    return bounties.claim(created.id, contributor.id);
  }

  async function seedTeam(
    members: Array<{ user: User; percentage: string }>,
  ): Promise<Team> {
    return teamRepo.save(
      teamRepo.create({
        name: `team-${nextId()}`,
        splits: members.map(
          ({ user, percentage }) =>
            ({ userId: user.id, percentage }) as TeamMemberSplit,
        ),
      }),
    );
  }

  // ── Delivery ─────────────────────────────────────────────────────────────

  function mergedPullRequestDelivery(
    repository: RepositoryEntity,
    issueNumber: number,
  ) {
    const prNumber = 1000 + issueNumber;
    return {
      action: 'closed',
      number: prNumber,
      pull_request: {
        html_url: `https://github.com/${repository.fullName}/pull/${prNumber}`,
        number: prNumber,
        merged: true,
        title: `Fix #${issueNumber}`,
        body: `Fixes #${issueNumber}`,
      },
      repository: {
        id: Number(repository.githubRepoId),
        full_name: repository.fullName,
      },
    };
  }

  /** POSTs the payload exactly as GitHub would: raw bytes + HMAC-SHA256. */
  function deliver(payload: object, deliveryId = randomUUID()) {
    const raw = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')}`;
    return request(app.getHttpServer())
      .post('/github/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', deliveryId)
      .set('X-Hub-Signature-256', signature)
      .send(raw);
  }

  // ── Specs ────────────────────────────────────────────────────────────────

  it('pays a single contributor the full escrow when their PR merges', async () => {
    if (!dbAvailable) {
      expect(process.env.CI).not.toBe('true');
      return;
    }

    const sponsor = await seedUser('sponsor');
    const contributor = await seedUser('contributor');
    const repository = await seedRepository();
    const issue = await seedIssue(repository, 11);
    const bounty = await seedFundedClaimedBounty(
      issue,
      sponsor,
      contributor,
      '250.5',
    );
    expect(bounty.status).toBe(BountyStatus.CLAIMED);
    expect(bounty.escrowId).toBeTruthy();

    // Prime the platform-summary cache so a refresh is observable: its TTL
    // (60s default) outlives this test, so only the PAID invalidation event
    // can make the next read reflect the payout.
    const before = await analytics.platformSummary();

    const res = await deliver(mergedPullRequestDelivery(repository, 11));
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      received: true,
      status: WebhookEventStatus.PROCESSED,
    });

    const event = await webhookEventRepo.findOneByOrFail({
      id: (res.body as { eventId: string }).eventId,
    });
    expect(event.signatureValid).toBe(true);
    expect(event.error ?? null).toBeNull();

    const paid = await bountyRepo.findOneByOrFail({ id: bounty.id });
    expect(paid.status).toBe(BountyStatus.PAID);
    expect(paid.mergedAt).toBeInstanceOf(Date);
    expect(paid.paidAt).toBeInstanceOf(Date);
    expect(paid.prNumber).toBe(1011);

    const escrow = await escrowRepo.findOneByOrFail({ id: bounty.escrowId! });
    expect(escrow.status).toBe(EscrowStatus.DRY_RUN);
    expect(escrow.releaseTxHash).toBeTruthy();

    const payments = await paymentRepo.find({
      where: { escrowId: escrow.id },
    });
    expect(payments).toHaveLength(2);
    const payout = payments.find((payment) => !payment.isProtocolFee)!;
    const fee = payments.find((payment) => payment.isProtocolFee)!;
    expect(payout).toMatchObject({
      recipientId: contributor.id,
      recipientAddress: contributor.stellarAddress,
      asset: AssetType.USDC,
      status: PaymentStatus.DRY_RUN,
      txHash: escrow.releaseTxHash,
    });
    expect(fee).toMatchObject({
      amount: '6.2625000',
      status: PaymentStatus.DRY_RUN,
    });
    expect(escrow.protocolFeeAmount).toBe('6.2625000');
    expect(amountToStroops(payout.amount) + amountToStroops(fee.amount)).toBe(
      amountToStroops(escrow.amount),
    );

    const after = await analytics.platformSummary();
    expect(after.totalPaidOut).toBe(before.totalPaidOut);
  });

  it('splits a team bounty into one payment per member summing to the escrow', async () => {
    if (!dbAvailable) {
      expect(process.env.CI).not.toBe('true');
      return;
    }

    const sponsor = await seedUser('sponsor');
    const lead = await seedUser('lead');
    const second = await seedUser('second');
    const third = await seedUser('third');
    const repository = await seedRepository();
    const issue = await seedIssue(repository, 22);
    // An amount that does not divide evenly into thirds, so the
    // largest-remainder allocation is what keeps the sum exact.
    const bounty = await seedFundedClaimedBounty(issue, sponsor, lead, '100');
    const members = [
      { user: lead, percentage: '33.34' },
      { user: second, percentage: '33.33' },
      { user: third, percentage: '33.33' },
    ];
    const team = await seedTeam(members);
    await bountyRepo.update(bounty.id, { teamId: team.id });

    const before = await analytics.platformSummary();

    const res = await deliver(mergedPullRequestDelivery(repository, 22));
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: WebhookEventStatus.PROCESSED });

    const paid = await bountyRepo.findOneByOrFail({ id: bounty.id });
    expect(paid.status).toBe(BountyStatus.PAID);

    const escrow = await escrowRepo.findOneByOrFail({ id: bounty.escrowId! });
    expect(escrow.status).toBe(EscrowStatus.DRY_RUN);

    const payments = await paymentRepo.find({
      where: { escrowId: escrow.id },
    });
    expect(payments).toHaveLength(4);
    const recipientPayments = payments.filter(
      (payment) => !payment.isProtocolFee,
    );
    const fee = payments.find((payment) => payment.isProtocolFee)!;

    for (const { user, percentage } of members) {
      const payment = recipientPayments.find((p) => p.recipientId === user.id);
      expect(payment).toBeDefined();
      expect(payment).toMatchObject({
        recipientAddress: user.stellarAddress,
        status: PaymentStatus.DRY_RUN,
        txHash: escrow.releaseTxHash,
      });
      expect(Number(payment!.splitPercentage)).toBeCloseTo(
        Number(percentage),
        2,
      );
    }

    const total = recipientPayments.reduce(
      (sum, p) => sum + amountToStroops(p.amount),
      0n,
    );
    expect(total + amountToStroops(fee.amount)).toBe(
      amountToStroops(escrow.amount),
    );
    expect(fee.amount).toBe('2.5000000');

    const after = await analytics.platformSummary();
    expect(after.totalPaidOut).toBe(before.totalPaidOut);
  });

  it('rejects an unsigned delivery without touching the bounty', async () => {
    if (!dbAvailable) {
      expect(process.env.CI).not.toBe('true');
      return;
    }

    const sponsor = await seedUser('sponsor');
    const contributor = await seedUser('contributor');
    const repository = await seedRepository();
    const issue = await seedIssue(repository, 33);
    const bounty = await seedFundedClaimedBounty(
      issue,
      sponsor,
      contributor,
      '10',
    );

    await request(app.getHttpServer())
      .post('/github/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', randomUUID())
      .set('X-Hub-Signature-256', 'sha256=deadbeef')
      .send(JSON.stringify(mergedPullRequestDelivery(repository, 33)))
      .expect(401);

    const unchanged = await bountyRepo.findOneByOrFail({ id: bounty.id });
    expect(unchanged.status).toBe(BountyStatus.CLAIMED);
    expect(
      await paymentRepo.count({ where: { escrowId: bounty.escrowId! } }),
    ).toBe(0);
  });
});
