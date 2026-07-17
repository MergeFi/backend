import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SponsorsService } from './sponsors.service';
import { Bounty, Escrow, Milestone, Payment } from '../common/entities';
import { EscrowStatus, PaymentStatus } from '../common/enums';

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
  });
});
