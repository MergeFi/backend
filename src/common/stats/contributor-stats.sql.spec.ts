import { Repository } from 'typeorm';
import { Bounty, Payment } from '../entities';
import {
  queryContributorCoreStats,
  queryPayoutHeatmap,
  queryTopClients,
} from './contributor-stats.sql';

describe('ContributorStats SQL Aggregations (Unit)', () => {
  const userId = 'user-contributor-123';

  describe('queryPayoutHeatmap', () => {
    it('aggregates confirmed payments by UTC date', async () => {
      const mockRows = [
        { date: '2023-01-01', count: '2' },
        { date: '2023-01-02', count: '1' },
      ];

      const qb: any = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockRows),
      };

      const createQueryBuilder = jest.fn().mockReturnValue(qb);
      const mockPaymentRepo = {
        createQueryBuilder,
      } as unknown as Repository<Payment>;

      const result = await queryPayoutHeatmap(mockPaymentRepo, userId);

      expect(createQueryBuilder).toHaveBeenCalledWith('payment');
      expect(qb.where).toHaveBeenCalledWith('payment.recipientId = :userId', {
        userId,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('payment.status = :status', {
        status: 'confirmed',
      });
      expect(result).toEqual([
        { date: '2023-01-01', count: 2 },
        { date: '2023-01-02', count: 1 },
      ]);
    });

    it('applies date window when range from/to are supplied', async () => {
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      const mockPaymentRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      } as unknown as Repository<Payment>;

      const from = new Date('2023-01-01T00:00:00Z');
      const toExclusive = new Date('2023-01-10T00:00:00Z');

      await queryPayoutHeatmap(mockPaymentRepo, userId, { from, toExclusive });

      expect(qb.andWhere).toHaveBeenCalledWith('payment.createdAt >= :from', {
        from,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'payment.createdAt < :toExclusive',
        { toExclusive },
      );
    });
  });

  describe('queryTopClients', () => {
    it('aggregates payments by escrow.sponsorId and orders descending', async () => {
      const mockRows = [
        { sponsorId: 'sponsor-gold', totalPaid: '500.50' },
        { sponsorId: 'sponsor-silver', totalPaid: '120.00' },
      ];

      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(mockRows),
      };

      const createQueryBuilder = jest.fn().mockReturnValue(qb);
      const mockPaymentRepo = {
        createQueryBuilder,
      } as unknown as Repository<Payment>;

      const result = await queryTopClients(mockPaymentRepo, userId);

      expect(createQueryBuilder).toHaveBeenCalledWith('payment');
      expect(qb.innerJoin).toHaveBeenCalledWith('payment.escrow', 'escrow');
      expect(qb.where).toHaveBeenCalledWith('payment.recipientId = :userId', {
        userId,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('payment.status = :status', {
        status: 'confirmed',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('escrow.sponsorId IS NOT NULL');
      expect(result).toEqual([
        { sponsorId: 'sponsor-gold', totalPaid: 500.5 },
        { sponsorId: 'sponsor-silver', totalPaid: 120 },
      ]);
    });
  });

  describe('queryContributorCoreStats', () => {
    it('accurately computes stats when contributor has payment earnings but zero bounties (e.g. milestone or pool payouts)', async () => {
      const mockBountyCounts = {
        claimedCount: '0',
        mergedCount: '0',
        openBountiesClaimed: '0',
        avgReviewTimeHours: '0',
        onTimeCount: '0',
        repoCount: '0',
        orgCount: '0',
      };

      const bountyCountsQb: any = {
        leftJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(mockBountyCounts),
      };

      const bountyLangQb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      const bountyOrgQb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      const mockBountyRepo = {
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(bountyCountsQb)
          .mockReturnValueOnce(bountyLangQb)
          .mockReturnValueOnce(bountyOrgQb),
      } as unknown as Repository<Bounty>;

      const paymentEarningsQb: any = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest
          .fn()
          .mockResolvedValue({ lifetimeEarnings: '750.1234567' }),
      };

      const mockPaymentRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(paymentEarningsQb),
      } as unknown as Repository<Payment>;

      const stats = await queryContributorCoreStats(
        mockBountyRepo,
        mockPaymentRepo,
        userId,
      );

      expect(stats.lifetimeEarnings).toBe(750.1234567);
      expect(stats.claimedCount).toBe(0);
      expect(stats.mergedCount).toBe(0);
      expect(stats.completionRate).toBe(0);
      expect(paymentEarningsQb.where).toHaveBeenCalledWith(
        'payment.recipientId = :userId',
        { userId },
      );
      expect(paymentEarningsQb.andWhere).toHaveBeenCalledWith(
        'payment.status = :status',
        { status: 'confirmed' },
      );
    });
  });
});
