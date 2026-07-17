import { DataSource, Repository } from 'typeorm';
import { entities } from '../common/entities/typeorm-entities';
import {
  Bounty,
  Escrow,
  Milestone,
  Payment,
  Repository as Repo,
  Issue,
  User,
} from '../common/entities';
import {
  AssetType,
  BountyStatus,
  EscrowStatus,
  PaymentStatus,
} from '../common/enums';
import { SponsorsService } from '../sponsors/sponsors.service';

/**
 * Integration tests for #27: these hit a real Postgres (see
 * .github/workflows/ci.yml's `postgres` service / docker-compose.yml's `db`
 * service — DATABASE_URL must point at a real, disposable database). Every
 * other .spec.ts in this repo mocks its repositories; the whole point of
 * this bug is DB-level FK/CHECK behavior that a mocked repository can't
 * exercise, so this file uses `synchronize: true` against a real connection
 * to build the schema straight from the (now-fixed) entity decorators.
 */
describe('Escrow FK integrity + sponsor dashboard reconciliation (integration)', () => {
  let dataSource: DataSource;
  let bountyRepo: Repository<Bounty>;
  let milestoneRepo: Repository<Milestone>;
  let paymentRepo: Repository<Payment>;
  let escrowRepo: Repository<Escrow>;
  let repoRepo: Repository<Repo>;
  let issueRepo: Repository<Issue>;
  let userRepo: Repository<User>;
  let sponsorsService: SponsorsService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5432/mergefi',
      entities,
      synchronize: true,
      dropSchema: true,
    });
    await dataSource.initialize();

    bountyRepo = dataSource.getRepository(Bounty);
    milestoneRepo = dataSource.getRepository(Milestone);
    paymentRepo = dataSource.getRepository(Payment);
    escrowRepo = dataSource.getRepository(Escrow);
    repoRepo = dataSource.getRepository(Repo);
    issueRepo = dataSource.getRepository(Issue);
    userRepo = dataSource.getRepository(User);

    sponsorsService = new SponsorsService(
      bountyRepo,
      milestoneRepo,
      paymentRepo,
      escrowRepo,
    );
  }, 30_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  afterEach(async () => {
    // Delete in child-to-parent order — payments/escrows first now that
    // their FKs are SET NULL/RESTRICT instead of CASCADE, they won't be
    // cleaned up automatically by deleting bounties/milestones.
    await paymentRepo.query('DELETE FROM payments');
    await escrowRepo.query('DELETE FROM escrows');
    await bountyRepo.query('DELETE FROM bounties');
    await issueRepo.query('DELETE FROM issues');
    await milestoneRepo.query('DELETE FROM milestones');
    await repoRepo.query('DELETE FROM repositories');
    await userRepo.query('DELETE FROM users');
  });

  async function makeSponsor(): Promise<User> {
    return userRepo.save(
      userRepo.create({ username: `sponsor-${Date.now()}-${Math.random()}` }),
    );
  }

  async function makeBounty(
    sponsorId: string,
    amount = '100',
  ): Promise<Bounty> {
    const repository = await repoRepo.save(
      repoRepo.create({
        githubRepoId: `repo-${Date.now()}-${Math.random()}`,
        owner: 'octocat',
        name: `repo-${Math.random()}`,
        fullName: 'octocat/repo',
      }),
    );
    const issue = await issueRepo.save(
      issueRepo.create({
        repositoryId: repository.id,
        githubIssueId: `issue-${Date.now()}-${Math.random()}`,
        number: 1,
        title: 'Fix the bug',
        githubUrl: 'https://github.com/octocat/repo/issues/1',
      }),
    );
    return bountyRepo.save(
      bountyRepo.create({
        issueId: issue.id,
        sponsorId,
        amount,
        asset: AssetType.USDC,
        status: BountyStatus.FUNDED,
      }),
    );
  }

  async function makeMilestone(
    sponsorId: string,
    budget = '100',
  ): Promise<Milestone> {
    const repository = await repoRepo.save(
      repoRepo.create({
        githubRepoId: `repo-${Date.now()}-${Math.random()}`,
        owner: 'octocat',
        name: `repo-${Math.random()}`,
        fullName: 'octocat/repo',
      }),
    );
    return milestoneRepo.save(
      milestoneRepo.create({
        repositoryId: repository.id,
        sponsorId,
        title: 'Q1 roadmap',
        budget,
        asset: AssetType.USDC,
      }),
    );
  }

  describe('CHK_escrow_at_most_one_parent', () => {
    it('rejects an escrow with more than one parent set', async () => {
      const sponsor = await makeSponsor();
      // Both parents reference genuinely existing rows, so the only way
      // this insert can fail is the CHECK constraint — not a coincidental
      // FK violation on a dangling id.
      const bounty = await makeBounty(sponsor.id);
      const milestone = await makeMilestone(sponsor.id);

      await expect(
        escrowRepo.query(
          `INSERT INTO escrows (id, "bountyId", "milestoneId", amount, asset, status)
           VALUES (gen_random_uuid(), $1, $2, '10', 'USDC', 'pending')`,
          [bounty.id, milestone.id],
        ),
      ).rejects.toThrow(/CHK_escrow_at_most_one_parent/);
    });

    it('allows an escrow with exactly one parent set', async () => {
      const sponsor = await makeSponsor();
      const bounty = await makeBounty(sponsor.id);

      const escrow = await escrowRepo.save(
        escrowRepo.create({
          bountyId: bounty.id,
          sponsorId: sponsor.id,
          amount: '10',
          asset: AssetType.USDC,
          status: EscrowStatus.LOCKED,
        }),
      );

      expect(escrow.id).toBeDefined();
    });

    it('allows an escrow with zero parents set (the orphaned-by-deletion state)', async () => {
      // The DB-level constraint deliberately allows this — it's exactly
      // the state ON DELETE SET NULL produces when an escrow's parent is
      // deleted (see the next describe block). "Exactly one" is an
      // application-level rule enforced at creation time in
      // EscrowService.assertExactlyOneParent, not a DB invariant, because
      // the DB has no way to distinguish "never had a parent" from
      // "orphaned by a legitimate deletion".
      const escrow = await escrowRepo.save(
        escrowRepo.create({
          amount: '10',
          asset: AssetType.USDC,
          status: EscrowStatus.LOCKED,
        }),
      );

      expect(escrow.id).toBeDefined();
    });
  });

  describe('parent deletion no longer destroys the escrow ledger row', () => {
    it('SET NULLs escrows.bountyId instead of deleting the row when the bounty is deleted', async () => {
      const sponsor = await makeSponsor();
      const bounty = await makeBounty(sponsor.id);
      const escrow = await escrowRepo.save(
        escrowRepo.create({
          bountyId: bounty.id,
          sponsorId: sponsor.id,
          amount: '250',
          asset: AssetType.USDC,
          status: EscrowStatus.LOCKED,
        }),
      );

      await bountyRepo.delete(bounty.id);

      const survived = await escrowRepo.findOne({ where: { id: escrow.id } });
      expect(survived).not.toBeNull();
      expect(survived?.bountyId).toBeNull();
      expect(survived?.status).toBe(EscrowStatus.LOCKED);
      expect(Number(survived?.amount)).toBe(250);
    });

    it('RESTRICTs deleting an escrow that still has payment records', async () => {
      const sponsor = await makeSponsor();
      const bounty = await makeBounty(sponsor.id);
      const escrow = await escrowRepo.save(
        escrowRepo.create({
          bountyId: bounty.id,
          sponsorId: sponsor.id,
          amount: '250',
          asset: AssetType.USDC,
          status: EscrowStatus.RELEASED,
        }),
      );
      await paymentRepo.save(
        paymentRepo.create({
          escrowId: escrow.id,
          recipientAddress: 'GRECIPIENT',
          amount: '250',
          asset: AssetType.USDC,
          status: PaymentStatus.CONFIRMED,
        }),
      );

      await expect(escrowRepo.delete(escrow.id)).rejects.toThrow();
    });
  });

  describe('sponsor dashboard figures survive parent bounty deletion (#27 acceptance criterion)', () => {
    it('budgetLocked keeps counting a stranded escrow after its bounty is deleted', async () => {
      const sponsor = await makeSponsor();
      const bounty = await makeBounty(sponsor.id, '400');
      await escrowRepo.save(
        escrowRepo.create({
          bountyId: bounty.id,
          sponsorId: sponsor.id,
          amount: '400',
          asset: AssetType.USDC,
          status: EscrowStatus.LOCKED,
        }),
      );

      expect(await sponsorsService.budgetLocked(sponsor.id)).toBe(400);

      await bountyRepo.delete(bounty.id);

      // The old implementation summed Bounty.amount by Bounty.status, so
      // this figure would silently drop to 0 the instant the bounty row
      // was gone — even though the funds are still LOCKED on-chain.
      expect(await sponsorsService.budgetLocked(sponsor.id)).toBe(400);
    });

    it('totalSpend keeps counting a confirmed payment after its bounty is deleted', async () => {
      const sponsor = await makeSponsor();
      const bounty = await makeBounty(sponsor.id, '150');
      const escrow = await escrowRepo.save(
        escrowRepo.create({
          bountyId: bounty.id,
          sponsorId: sponsor.id,
          amount: '150',
          asset: AssetType.USDC,
          status: EscrowStatus.RELEASED,
        }),
      );
      await paymentRepo.save(
        paymentRepo.create({
          escrowId: escrow.id,
          recipientAddress: 'GRECIPIENT',
          amount: '150',
          asset: AssetType.USDC,
          status: PaymentStatus.CONFIRMED,
        }),
      );

      expect(await sponsorsService.totalSpend(sponsor.id)).toBe(150);

      await bountyRepo.delete(bounty.id);

      expect(await sponsorsService.totalSpend(sponsor.id)).toBe(150);
    });
  });
});
