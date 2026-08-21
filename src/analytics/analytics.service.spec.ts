import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { Bounty, Issue, Payment, Repository as RepositoryEntity } from '../common/entities';
import { BountyStatus, PaymentStatus } from '../common/enums';

function createMockQueryBuilder(result: { raw?: unknown; many?: unknown[] }) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(result.raw),
    getRawMany: jest.fn().mockResolvedValue(result.many ?? []),
    getMany: jest.fn().mockResolvedValue(result.many ?? []),
  };
  return qb;
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let bountyRepo: { find: jest.Mock; count: jest.Mock; createQueryBuilder: jest.Mock };
  let issueRepo: { find: jest.Mock };
  let paymentRepo: { createQueryBuilder: jest.Mock };
  let repositoryRepo: { count: jest.Mock };

  beforeEach(async () => {
    bountyRepo = { find: jest.fn().mockResolvedValue([]), count: jest.fn(), createQueryBuilder: jest.fn() };
    issueRepo = { find: jest.fn().mockResolvedValue([]) };
    paymentRepo = { createQueryBuilder: jest.fn() };
    repositoryRepo = { count: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(RepositoryEntity), useValue: repositoryRepo },
      ],
    }).compile();

    service = module.get(AnalyticsService);
  });

  describe('forContributor', () => {
    it('computes lifetimeEarnings and topClients from confirmed payments ledger', async () => {
      bountyRepo.find.mockResolvedValue([
        {
          id: 'b-1',
          claimedById: 'user-1',
          amount: '1000.0000000',
          status: BountyStatus.PAID,
          claimedAt: new Date('2026-01-01T00:00:00Z'),
          mergedAt: new Date('2026-01-01T02:00:00Z'),
          paidAt: new Date('2026-01-01T02:30:00Z'),
          issueId: 'issue-1',
          sponsorId: 'sponsor-1',
        },
      ]);
      issueRepo.find.mockResolvedValue([]);

      const earningsQb = createMockQueryBuilder({ raw: { total: '200.0000000' } });
      const clientsQb = createMockQueryBuilder({
        many: [{ sponsorId: 'sponsor-1', totalPaid: '200.0000000' }],
      });

      paymentRepo.createQueryBuilder
        .mockReturnValueOnce(earningsQb)
        .mockReturnValueOnce(clientsQb);

      const result = await service.forContributor('user-1');

      expect(result.lifetimeEarnings).toBe(200);
      expect(result.topClients).toEqual([{ sponsorId: 'sponsor-1', totalPaid: 200 }]);
    });
  });
});
