import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SponsorsService } from './sponsors.service';
import { Bounty, Escrow, Milestone, Payment } from '../common/entities';
import { EscrowStatus, MilestoneStatus, PaymentStatus } from '../common/enums';

/**
 * Minimal fluent mock of TypeORM's QueryBuilder: every chainable method
 * returns the same object, and the two terminal methods resolve to
 * whatever the test configures via `result`.
 */
function createMockQueryBuilder(result: { raw?: unknown; many?: unknown[] }) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(result.raw),
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

  describe('activeBounties', () => {
    it('queries bounties by sponsorId excluding terminal statuses', async () => {
      const mockBounties = [{ id: 'b1', sponsorId: 'sponsor-1' }];
      const qb = createMockQueryBuilder({ many: mockBounties });
      bountyRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.activeBounties('sponsor-1');

      expect(bountyRepo.createQueryBuilder).toHaveBeenCalledWith('bounty');
      expect(qb.where).toHaveBeenCalledWith('bounty.sponsorId = :sponsorId', {
        sponsorId: 'sponsor-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'bounty.status NOT IN (:...terminal)',
        {
          terminal: ['paid', 'refunded', 'expired'],
        },
      );
      expect(res).toEqual(mockBounties);
    });
  });

  describe('activeMilestones', () => {
    it('finds milestones with FUNDED or IN_PROGRESS status for sponsor', async () => {
      const mockMilestones = [
        { id: 'm1', sponsorId: 'sponsor-1', status: MilestoneStatus.FUNDED },
      ];
      milestoneRepo.find.mockResolvedValue(mockMilestones);

      const res = await service.activeMilestones('sponsor-1');

      expect(milestoneRepo.find).toHaveBeenCalledWith({
        where: [
          { sponsorId: 'sponsor-1', status: MilestoneStatus.FUNDED },
          { sponsorId: 'sponsor-1', status: MilestoneStatus.IN_PROGRESS },
        ],
      });
      expect(res).toEqual(mockMilestones);
    });
  });

  describe('milestoneProgress', () => {
    it('calculates progress ratio and guards against division by zero', async () => {
      milestoneRepo.find.mockResolvedValue([
        { id: 'm1', title: 'M1', budget: '1000', distributed: '500' },
        { id: 'm2', title: 'M2', budget: '0', distributed: '0' },
      ]);

      const progress = await service.milestoneProgress('sponsor-1');

      expect(milestoneRepo.find).toHaveBeenCalledWith({
        where: { sponsorId: 'sponsor-1' },
      });
      expect(progress).toEqual([
        { milestoneId: 'm1', title: 'M1', progress: 0.5 },
        { milestoneId: 'm2', title: 'M2', progress: 0 },
      ]);
    });
  });

  describe('budgetLocked', () => {
    it('sums Escrow.amount directly, filtered by sponsorId and LOCKED status', async () => {
      const qb = createMockQueryBuilder({ raw: { total: '1250.5000000' } });
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
      const qb = createMockQueryBuilder({ raw: { total: '0' } });
      escrowRepo.createQueryBuilder.mockReturnValue(qb);

      await service.budgetLocked('sponsor-1');

      expect(bountyRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns 0 when there is no locked escrow for the sponsor', async () => {
      const qb = createMockQueryBuilder({ raw: undefined });
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
  });
});
