import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReputationService } from './reputation.service';
import { Bounty, Issue, Payment, ReputationSnapshot } from '../common/entities';
import { BountyStatus, PaymentStatus } from '../common/enums';

function createMockQueryBuilder(result: { raw?: unknown; many?: unknown[] }) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(result.raw),
    getRawMany: jest.fn().mockResolvedValue(result.many ?? []),
    getMany: jest.fn().mockResolvedValue(result.many ?? []),
  };
  return qb;
}

describe('ReputationService', () => {
  let service: ReputationService;
  let bountyRepo: { find: jest.Mock };
  let issueRepo: { find: jest.Mock };
  let paymentRepo: { createQueryBuilder: jest.Mock };
  let snapshotRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; find: jest.Mock };

  beforeEach(async () => {
    bountyRepo = { find: jest.fn().mockResolvedValue([]) };
    issueRepo = { find: jest.fn().mockResolvedValue([]) };
    paymentRepo = { createQueryBuilder: jest.fn() };
    snapshotRepo = {
      create: jest.fn((d) => d),
      save: jest.fn((s) => Promise.resolve({ id: 'snap-1', ...s })),
      findOne: jest.fn(),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReputationService,
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(ReputationSnapshot), useValue: snapshotRepo },
      ],
    }).compile();

    service = module.get(ReputationService);
  });

  describe('computeAndSave', () => {
    it('computes totalEarnings from confirmed payments rather than full Bounty.amount for team splits', async () => {
      // Bounty was for $1000, but user received a 20% split ($200)
      bountyRepo.find.mockResolvedValue([
        {
          id: 'b-1',
          claimedById: 'user-1',
          amount: '1000.0000000',
          status: BountyStatus.PAID,
          claimedAt: new Date('2026-01-01T00:00:00Z'),
          mergedAt: new Date('2026-01-01T02:00:00Z'),
          issueId: 'issue-1',
        },
      ]);
      issueRepo.find.mockResolvedValue([]);

      const qb = createMockQueryBuilder({ raw: { total: '200.0000000' } });
      paymentRepo.createQueryBuilder.mockReturnValue(qb);

      const snapshot = await service.computeAndSave('user-1');

      expect(paymentRepo.createQueryBuilder).toHaveBeenCalledWith('payment');
      expect(qb.where).toHaveBeenCalledWith('payment.recipientId = :recipientId', {
        recipientId: 'user-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('payment.status = :status', {
        status: PaymentStatus.CONFIRMED,
      });
      expect(snapshot.totalEarnings).toBe('200.0000000');
    });

    it('handles zero confirmed payments correctly', async () => {
      bountyRepo.find.mockResolvedValue([]);
      issueRepo.find.mockResolvedValue([]);

      const qb = createMockQueryBuilder({ raw: undefined });
      paymentRepo.createQueryBuilder.mockReturnValue(qb);

      const snapshot = await service.computeAndSave('user-1');
      expect(snapshot.totalEarnings).toBe('0.0000000');
    });
  });
});
