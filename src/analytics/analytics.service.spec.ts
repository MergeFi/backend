import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { Bounty, Issue, Repository as RepositoryEntity, Payment } from '../common/entities';
import { BountyStatus } from '../common/enums';

function createMockQueryBuilder(result: { raw?: unknown; many?: unknown[] }) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(result.raw),
    getRawMany: jest.fn().mockResolvedValue(result.many ?? []),
  };
  return qb;
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let bountyRepo: { find: jest.Mock; count: jest.Mock; createQueryBuilder: jest.Mock };
  let issueRepo: { find: jest.Mock };
  let repositoryRepo: { count: jest.Mock };
  let paymentRepo: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    bountyRepo = { find: jest.fn().mockResolvedValue([]), count: jest.fn(), createQueryBuilder: jest.fn() };
    issueRepo = { find: jest.fn().mockResolvedValue([]) };
    repositoryRepo = { count: jest.fn() };
    paymentRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
        { provide: getRepositoryToken(RepositoryEntity), useValue: repositoryRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
      ],
    }).compile();

    service = module.get(AnalyticsService);
  });

  describe('forContributor', () => {
    it('computes lifetimeEarnings and topClients from Payment ledger, attributing actual received share for team-splits', async () => {
      // Simulate user claiming a team-split bounty.
      // E.g. $1000 bounty, but user received 20% = $200.
      bountyRepo.find.mockResolvedValue([
        { id: 'b1', amount: '1000', status: BountyStatus.PAID, issueId: 'i1', sponsorId: 's1' },
      ]);

      // The payment query should return the 20% share.
      const qb = createMockQueryBuilder({
        many: [{ sponsorId: 's1', total: '200' }],
      });
      paymentRepo.createQueryBuilder.mockReturnValue(qb);

      const analytics = await service.forContributor('user-1');

      // The analytics should have 200, NOT 1000.
      expect(analytics.lifetimeEarnings).toBe(200);
      expect(analytics.topClients).toEqual([{ sponsorId: 's1', totalPaid: 200 }]);
      
      expect(paymentRepo.createQueryBuilder).toHaveBeenCalledWith('payment');
      expect(qb.where).toHaveBeenCalledWith('payment.recipientId = :userId', { userId: 'user-1' });
    });
  });
});
