import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { entities } from '../common/entities/typeorm-entities';
import {
  Bounty,
  Issue,
  ReputationSnapshot,
  Repository as Repo,
  User,
} from '../common/entities';
import { AssetType, BountyDifficulty, BountyStatus } from '../common/enums';
import { AnalyticsService } from '../analytics/analytics.service';
import { AppConfig } from '../config/configuration';
import { computeContributorStats } from '../common/stats/contributor-stats.util';
import { ReputationService } from '../reputation/reputation.service';

/**
 * Load / correctness test for analytics SQL aggregation (#heatmap / top-N /
 * homepage cache).
 *
 * Big-O change:
 * - Before: `bountyRepo.find({ claimedById })` loaded O(n) Bounty entities
 *   plus O(n) Issue rows into Node, then Map/sort in JS (n = claimed
 *   bounties). A 3_000-row seed would hydrate 3_000+3_000 entities.
 * - After: GROUP BY / SUM / COUNT / LIMIT 10 queries; app memory is
 *   O(D) heatmap days (D ≤ 366) + O(1) top-clients + O(L) languages.
 *   Homepage summary is O(1) rows per query and O(1) after the in-process TTL.
 *
 * Wall-clock is environment-dependent; the find/getMany spies and bounded
 * array lengths are the real gate. Query budget: forContributor < 2s on
 * this seed; cached platformSummary second call should be trivial.
 *
 * Isolated in schema `analytics_itest` so it can run alongside the escrow
 * FK integration spec without dropSchema races.
 */
describe('Analytics SQL aggregation (integration)', () => {
  let dataSource: DataSource;
  let bountyRepo: Repository<Bounty>;
  let issueRepo: Repository<Issue>;
  let repoRepo: Repository<Repo>;
  let userRepo: Repository<User>;
  let analytics: AnalyticsService;
  let reputation: ReputationService;
  let dbAvailable = false;

  const SEED_PAID = 3_000;
  const SEED_DAYS = 180;
  const SEED_SPONSORS = 40;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5432/mergefi',
      schema: 'analytics_itest',
      entities,
      synchronize: true,
      dropSchema: true,
    });
    try {
      await dataSource.initialize();
    } catch (err) {
      console.warn(
        'Skipping analytics integration tests: Postgres is not reachable at DATABASE_URL.',
        err,
      );
      return;
    }
    dbAvailable = true;

    bountyRepo = dataSource.getRepository(Bounty);
    issueRepo = dataSource.getRepository(Issue);
    repoRepo = dataSource.getRepository(Repo);
    userRepo = dataSource.getRepository(User);

    const configService = {
      get: () => ({ platformSummaryTtlMs: 60_000 }),
    } as unknown as ConfigService<AppConfig, true>;
    analytics = new AnalyticsService(bountyRepo, repoRepo, configService);
    reputation = new ReputationService(
      bountyRepo,
      dataSource.getRepository(ReputationSnapshot),
    );
  }, 30_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('matches JS contributor-stats on a small fixture (UTC heatmap + top-10)', async () => {
    if (!dbAvailable) {
      expect(process.env.CI).not.toBe('true');
      return;
    }
    const contributor = await userRepo.save(
      userRepo.create({ username: `gold-contrib-${randomUUID()}` }),
    );
    const sponsorA = await userRepo.save(
      userRepo.create({ username: `gold-a-${randomUUID()}` }),
    );
    const sponsorB = await userRepo.save(
      userRepo.create({ username: `gold-b-${randomUUID()}` }),
    );
    const repository = await repoRepo.save(
      repoRepo.create({
        githubRepoId: `gold-${randomUUID()}`,
        owner: 'acme',
        name: 'widgets',
        fullName: 'acme/widgets',
        primaryLanguage: 'TypeScript',
      }),
    );
    const repo2 = await repoRepo.save(
      repoRepo.create({
        githubRepoId: `gold-${randomUUID()}`,
        owner: 'acme',
        name: 'tools',
        fullName: 'acme/tools',
        primaryLanguage: 'TypeScript',
      }),
    );

    const issues: Issue[] = [];
    const claimed: Bounty[] = [];
    const specs: Array<{
      amount: string;
      paidAt: Date;
      sponsorId: string;
      repositoryId: string;
    }> = [
      {
        amount: '100',
        paidAt: new Date('2023-01-01T10:00:00Z'),
        sponsorId: sponsorA.id,
        repositoryId: repository.id,
      },
      {
        amount: '200',
        paidAt: new Date('2023-01-01T15:00:00Z'),
        sponsorId: sponsorB.id,
        repositoryId: repo2.id,
      },
      {
        amount: '50',
        paidAt: new Date('2023-01-02T10:00:00Z'),
        sponsorId: sponsorA.id,
        repositoryId: repository.id,
      },
    ];
    for (const spec of specs) {
      const issue = await issueRepo.save(
        issueRepo.create({
          repositoryId: spec.repositoryId,
          githubIssueId: `gold-issue-${randomUUID()}`,
          number: issues.length + 1,
          title: 'gold',
          githubUrl: 'https://github.com/acme/widgets/issues/1',
        }),
      );
      const linkedRepo =
        spec.repositoryId === repository.id ? repository : repo2;
      issue.repository = linkedRepo;
      issues.push(issue);
      const bounty = await bountyRepo.save(
        bountyRepo.create({
          issueId: issue.id,
          sponsorId: spec.sponsorId,
          claimedById: contributor.id,
          amount: spec.amount,
          asset: AssetType.USDC,
          difficulty: BountyDifficulty.INTERMEDIATE,
          status: BountyStatus.PAID,
          paidAt: spec.paidAt,
          claimedAt: new Date('2022-12-31T00:00:00Z'),
          mergedAt: new Date('2023-01-01T00:00:00Z'),
        }),
      );
      claimed.push(bounty);
    }

    const js = computeContributorStats(claimed, issues);
    const sqlResult = await analytics.forContributor(contributor.id);

    expect(sqlResult.mergeRate).toBe(js.completionRate);
    expect(sqlResult.languages).toEqual(js.languages);
    expect(sqlResult.orgCount).toBe(js.orgs.length);
    expect(sqlResult.repoCount).toBe(2);
    expect(sqlResult.lifetimeEarnings).toBe(350);
    expect(sqlResult.heatmap).toEqual([
      { date: '2023-01-01', count: 2 },
      { date: '2023-01-02', count: 1 },
    ]);
    expect(sqlResult.topClients).toEqual([
      { sponsorId: sponsorB.id, totalPaid: 200 },
      { sponsorId: sponsorA.id, totalPaid: 150 },
    ]);
    expect(sqlResult.avgReviewTimeHours).toBeCloseTo(js.avgReviewTimeHours, 5);
  });

  it('aggregates thousands of paid bounties without hydrating them in Node', async () => {
    if (!dbAvailable) {
      expect(process.env.CI).not.toBe('true');
      return;
    }
    const contributor = await userRepo.save(
      userRepo.create({ username: `load-contrib-${randomUUID()}` }),
    );
    const sponsors: User[] = [];
    for (let i = 0; i < SEED_SPONSORS; i++) {
      sponsors.push(
        await userRepo.save(
          userRepo.create({ username: `load-sponsor-${i}-${randomUUID()}` }),
        ),
      );
    }
    const repos: Repo[] = [];
    for (let i = 0; i < 12; i++) {
      repos.push(
        await repoRepo.save(
          repoRepo.create({
            githubRepoId: `load-repo-${i}-${randomUUID()}`,
            owner: `org-${i % 6}`,
            name: `repo-${i}`,
            fullName: `org-${i % 6}/repo-${i}`,
            primaryLanguage: i % 2 === 0 ? 'TypeScript' : 'Rust',
          }),
        ),
      );
    }

    const issueValues: Partial<Issue>[] = [];
    const bountyValues: Partial<Bounty>[] = [];
    for (let i = 0; i < SEED_PAID; i++) {
      const issueId = randomUUID();
      const repo = repos[i % repos.length];
      issueValues.push({
        id: issueId,
        repositoryId: repo.id,
        githubIssueId: `load-issue-${i}-${randomUUID()}`,
        number: i + 1,
        title: `Issue ${i}`,
        githubUrl: `https://github.com/org/repo/issues/${i}`,
        labels: [],
      });
      const day = i % SEED_DAYS;
      bountyValues.push({
        id: randomUUID(),
        issueId,
        sponsorId: sponsors[i % sponsors.length].id,
        claimedById: contributor.id,
        amount: '10',
        asset: AssetType.USDC,
        difficulty: BountyDifficulty.INTERMEDIATE,
        status: BountyStatus.PAID,
        paidAt: new Date(Date.UTC(2024, 0, 1 + day, 15, 0, 0)),
        claimedAt: new Date(Date.UTC(2023, 11, 1, 0, 0, 0)),
        mergedAt: new Date(Date.UTC(2023, 11, 2, 0, 0, 0)),
      });
    }

    const chunk = 500;
    for (let i = 0; i < issueValues.length; i += chunk) {
      await issueRepo.insert(issueValues.slice(i, i + chunk));
      await bountyRepo.insert(bountyValues.slice(i, i + chunk));
    }

    const findSpy = jest.spyOn(bountyRepo, 'find');
    const getManySpy = jest.spyOn(SelectQueryBuilder.prototype, 'getMany');

    try {
      const started = Date.now();
      const result = await analytics.forContributor(contributor.id);
      const elapsedMs = Date.now() - started;

      expect(findSpy).not.toHaveBeenCalled();
      expect(getManySpy).not.toHaveBeenCalled();
      expect(result.heatmap.length).toBe(SEED_DAYS);
      expect(result.heatmap.length).toBeLessThanOrEqual(366);
      expect(result.topClients.length).toBeLessThanOrEqual(10);
      expect(result.topClients.length).toBe(10);
      expect(result.lifetimeEarnings).toBe(SEED_PAID * 10);
      expect(elapsedMs).toBeLessThan(2_000);
    } finally {
      findSpy.mockRestore();
      getManySpy.mockRestore();
    }

    const snap = await reputation.computeAndSave(contributor.id);
    expect(Number(snap.totalEarnings)).toBe(SEED_PAID * 10);
    expect(snap.mergedPrCount).toBe(SEED_PAID);

    await analytics.platformSummary();
    const cachedStart = Date.now();
    const cached = await analytics.platformSummary();
    const cachedMs = Date.now() - cachedStart;
    expect(cached.totalBounties).toBeGreaterThanOrEqual(SEED_PAID);
    expect(cachedMs).toBeLessThan(50);
  }, 60_000);
});
