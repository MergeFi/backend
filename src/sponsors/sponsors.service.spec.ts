import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SponsorsService } from './sponsors.service';
import { Bounty, Escrow, Milestone, Payment } from '../common/entities';
import {
  BountyStatus,
  EscrowStatus,
  MilestoneStatus,
  PaymentStatus,
} from '../common/enums';

/**
 * Minimal fluent mock of TypeORM's QueryBuilder: every chainable method
 * returns the same object, and the two terminal methods resolve to
 * whatever the test configures via `result`.
 */
function createMockQueryBuilder(result: {
  raw?: unknown;
  many?: unknown[];
  rawMany?: unknown[];
}) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(result.raw),
    getRawMany: jest.fn().mockResolvedValue(result.rawMany ?? []),
    getMany: jest.fn().mockResolvedValue(result.many ?? []),
  };
  return qb;
}

describe('SponsorsService', () => {
  let service: SponsorsService;
  let bountyRepo: { createQueryBuilder: jest.Mock };
  let milestoneRepo: { find: jest.Mock };
  let paymentRepo: { createQueryBuilder: jest.Mock };
  let escrowRepo: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    bountyRepo = { createQueryBuilder: jest.fn() };
    milestoneRepo = { find: jest.fn().mockResolvedValue([]) };
    paymentRepo = { createQueryBuilder: jest.fn() };
    escrowRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SponsorsService,
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: getRepositoryToken(Milestone), useValue: milestoneRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(Escrow), useValue: escrowRepo },
      ],
    }).compile();

    service = module.get(SponsorsService);
  });

  describe('budgetLocked', () => {
    it('sums Escrow.amount directly, filtered by sponsorId and LOCKED status', async () => {
      const qb = createMockQueryBuilder({
        rawMany: [
          { id: 'e1', amount: '1000.0000000', paid: '0' },
          { id: 'e2', amount: '250.5000000', paid: '0' },
        ],
      });
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      const total = await service.budgetLocked('sponsor-1');

      expect(escrowRepo.createQueryBuilder).toHaveBeenCalledWith('escrow');
      expect(qb.where).toHaveBeenCalledWith('escrow.sponsorId = :sponsorId', {
        sponsorId: 'sponsor-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('escrow.status = :status', {
        status: EscrowStatus.LOCKED,
      });
      expect(total).toBe(1250.5);
    });

    it('does not query the Bounty table at all (no drifted-proxy risk)', async () => {
      const qb = createMockQueryBuilder({ rawMany: [] });
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      await service.budgetLocked('sponsor-1');

      expect(bountyRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns 0 when there is no locked escrow for the sponsor', async () => {
      const qb = createMockQueryBuilder({ rawMany: [] });
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      expect(await service.budgetLocked('sponsor-1')).toBe(0);
    });

    it('subtracts confirmed partial payouts from a still-LOCKED escrow (#575)', async () => {
      // 1,000 USDC milestone escrow with 900 already paid out via
      // releasePartial: only 100 is still locked, not 1,000.
      const qb = createMockQueryBuilder({
        rawMany: [
          {
            id: 'milestone-escrow',
            amount: '1000.0000000',
            paid: '900.0000000',
          },
          { id: 'bounty-escrow', amount: '50.0000000', paid: '0' },
        ],
      });
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      expect(await service.budgetLocked('sponsor-1')).toBe(150);
      expect(qb.leftJoin).toHaveBeenCalledWith(
        'escrow.payments',
        'payment',
        'payment.status = :confirmed',
        { confirmed: PaymentStatus.CONFIRMED },
      );
      expect(qb.groupBy).toHaveBeenCalledWith('escrow.id');
    });

    it('never reports a negative remainder for an over-paid escrow (#575)', async () => {
      const qb = createMockQueryBuilder({
        rawMany: [{ id: 'e1', amount: '100.0000000', paid: '100.0000001' }],
      });
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      expect(await service.budgetLocked('sponsor-1')).toBe(0);
    });
  });

  describe('totalSpend', () => {
    it('sums confirmed Payment.amount joined to escrow.sponsorId', async () => {
      const qb = createMockQueryBuilder({ raw: { total: '300.0000000' } });
      paymentRepo.createQueryBuilder.mockReturnValue(qb);

      const total = await service.totalSpend('sponsor-1');

      expect(paymentRepo.createQueryBuilder).toHaveBeenCalledWith('payment');
      expect(qb.innerJoin).toHaveBeenCalledWith('payment.escrow', 'escrow');
      expect(qb.where).toHaveBeenCalledWith('escrow.sponsorId = :sponsorId', {
        sponsorId: 'sponsor-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('payment.status = :status', {
        status: PaymentStatus.CONFIRMED,
      });
      expect(total).toBe(300);
    });

    it('returns 0 when the sponsor has no confirmed payments', async () => {
      const qb = createMockQueryBuilder({ raw: undefined });
      paymentRepo.createQueryBuilder.mockReturnValue(qb);

      expect(await service.totalSpend('sponsor-1')).toBe(0);
    });
  });

  describe('dashboard', () => {
    it('joins recentPayments on escrow.sponsorId, not escrow.bounty.sponsorId', async () => {
      bountyRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder({ many: [] }),
      );
      escrowRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder({ raw: { total: '0' } }),
      );
      const paymentsQb = createMockQueryBuilder({ many: [] });
      paymentRepo.createQueryBuilder.mockImplementation(() => paymentsQb);

      await service.dashboard('sponsor-1');

      // recentPayments's join must key off escrow.sponsorId so it still
      // finds payments after the parent bounty/milestone is deleted, and so
      // milestone-funded payments (which never had a `bounty` at all) show
      // up too — see #27.
      expect(paymentsQb.innerJoin).toHaveBeenCalledWith(
        'payment.escrow',
        'escrow',
      );
      expect(paymentsQb.innerJoin).not.toHaveBeenCalledWith(
        'escrow.bounty',
        'bounty',
      );
      expect(paymentsQb.where).toHaveBeenCalledWith(
        'escrow.sponsorId = :sponsorId',
        { sponsorId: 'sponsor-1' },
      );
    });

    it('uses the default 20-payment window when no paging params are provided', async () => {
      bountyRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder({ many: [] }),
      );
      escrowRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder({ raw: { total: '0' } }),
      );
      const paymentsQb = createMockQueryBuilder({ many: [] });
      paymentRepo.createQueryBuilder.mockReturnValue(paymentsQb);

      await service.dashboard('sponsor-1');

      expect(paymentsQb.take).toHaveBeenCalledWith(20);
      expect(paymentsQb.skip).toHaveBeenCalledWith(0);
    });

    it('passes through pagination params to recentPayments', async () => {
      bountyRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder({ many: [] }),
      );
      escrowRepo.createQueryBuilder.mockReturnValue(
        createMockQueryBuilder({ raw: { total: '0' } }),
      );
      const paymentsQb = createMockQueryBuilder({ many: [] });
      paymentRepo.createQueryBuilder.mockReturnValue(paymentsQb);

      await service.dashboard('sponsor-1', { limit: 5, offset: 40 });

      expect(paymentsQb.take).toHaveBeenCalledWith(5);
      expect(paymentsQb.skip).toHaveBeenCalledWith(40);
    });
  });

  describe('activeBounties', () => {
    it('excludes terminal bounty statuses', async () => {
      const qb = createMockQueryBuilder({ many: [] });
      bountyRepo.createQueryBuilder.mockReturnValue(qb);

      await service.activeBounties('sponsor-1');

      expect(bountyRepo.createQueryBuilder).toHaveBeenCalledWith('bounty');
      expect(qb.where).toHaveBeenCalledWith('bounty.sponsorId = :sponsorId', {
        sponsorId: 'sponsor-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'bounty.status NOT IN (:...terminal)',
        {
          terminal: [
            BountyStatus.PAID,
            BountyStatus.REFUNDED,
            BountyStatus.EXPIRED,
          ],
        },
      );
    });
  });

  describe('activeMilestones', () => {
    it('matches funded or in-progress milestones for the sponsor', async () => {
      const milestones = [{ id: 'm1' }, { id: 'm2' }];
      milestoneRepo.find.mockResolvedValue(milestones);

      const result = await service.activeMilestones('sponsor-1');

      expect(milestoneRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { sponsorId: 'sponsor-1', status: MilestoneStatus.FUNDED },
            { sponsorId: 'sponsor-1', status: MilestoneStatus.IN_PROGRESS },
          ],
          take: 20,
          skip: 0,
        }),
      );
      expect(result).toBe(milestones);
    });

    it('forwards custom pagination parameters', async () => {
      milestoneRepo.find.mockResolvedValue([]);

      await service.activeMilestones('sponsor-1', { limit: 10, offset: 5 });

      expect(milestoneRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 5,
        }),
      );
    });
  });

  describe('milestoneProgress', () => {
    it('computes distributed / budget for each milestone', async () => {
      milestoneRepo.find.mockResolvedValue([
        {
          id: 'm1',
          title: 'One',
          budget: '100.0000000',
          distributed: '25.0000000',
        },
      ]);

      await expect(service.milestoneProgress('sponsor-1')).resolves.toEqual([
        {
          milestoneId: 'm1',
          title: 'One',
          progress: 0.25,
        },
      ]);
    });

    it('guards against division by zero when budget is zero', async () => {
      milestoneRepo.find.mockResolvedValue([
        { id: 'm1', title: 'Zero', budget: '0', distributed: '50.0000000' },
      ]);

      await expect(service.milestoneProgress('sponsor-1')).resolves.toEqual([
        {
          milestoneId: 'm1',
          title: 'Zero',
          progress: 0,
        },
      ]);
    });
  });

  describe('pagination order (#573)', () => {
    it('activeBounties orders by createdAt DESC, id DESC before paginating', async () => {
      const qb = createMockQueryBuilder({ many: [] });
      bountyRepo.createQueryBuilder.mockReturnValue(qb);

      await service.activeBounties('sponsor-1', { limit: 10, offset: 10 });

      expect(qb.orderBy).toHaveBeenCalledWith('bounty.createdAt', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('bounty.id', 'DESC');
    });

    it('activeMilestones and milestoneProgress pass a stable order to find()', async () => {
      await service.activeMilestones('sponsor-1', { limit: 10, offset: 10 });
      await service.milestoneProgress('sponsor-1', { limit: 10, offset: 10 });

      for (const [args] of milestoneRepo.find.mock.calls) {
        expect(args).toMatchObject({
          order: { createdAt: 'DESC', id: 'DESC' },
          take: 10,
          skip: 10,
        });
      }
      expect(milestoneRepo.find).toHaveBeenCalledTimes(2);
    });
  });
});
