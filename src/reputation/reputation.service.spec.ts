import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReputationService } from './reputation.service';
import { Bounty, Issue, ReputationSnapshot, Payment } from '../common/entities';
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

describe('ReputationService', () => {
  let service: ReputationService;
  let bountyRepo: { find: jest.Mock };
  let issueRepo: { find: jest.Mock };
  let snapshotRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; find: jest.Mock };
  let paymentRepo: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    bountyRepo = { find: jest.fn().mockResolvedValue([]) };
    issueRepo = { find: jest.fn().mockResolvedValue([]) };
    snapshotRepo = {
      create: jest.fn().mockImplementation((x) => x),
      save: jest.fn().mockImplementation((x) => x),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    paymentRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReputationService,
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
        { provide: getRepositoryToken(ReputationSnapshot), useValue: snapshotRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
      ],
    }).compile();

    service = module.get(ReputationService);
  });

  describe('computeAndSave', () => {
    it('computes totalEarnings from Payment ledger, attributing actual received share for team-splits', async () => {
      // Simulate user claiming a team-split bounty.
      // E.g. $1000 bounty, but user received 20% = $200.
      bountyRepo.find.mockResolvedValue([
        { id: 'b1', amount: '1000', status: BountyStatus.PAID, issueId: 'i1' },
      ]);

      // The payment query should return the 20% share.
      const qb = createMockQueryBuilder({
        many: [{ sponsorId: 's1', total: '200' }],
      });
      paymentRepo.createQueryBuilder.mockReturnValue(qb);

      const snapshot = await service.computeAndSave('user-1');

      // The snapshot should have 200, NOT 1000.
      expect(snapshot.totalEarnings).toBe('200.0000000');
      
      expect(paymentRepo.createQueryBuilder).toHaveBeenCalledWith('payment');
      expect(qb.where).toHaveBeenCalledWith('payment.recipientId = :userId', { userId: 'user-1' });
    });
  });
});
