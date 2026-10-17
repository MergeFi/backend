import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('ReputationController', () => {
  let controller: ReputationController;
  let service: ReputationService;

  const mockReputationService = {
    getLatest: jest.fn(),
    history: jest.fn(),
    computeAndSave: jest.fn(),
  };

  const userOwner: AuthenticatedUser = {
    userId: '11111111-1111-1111-1111-111111111111',
    githubId: '12345',
    username: 'alice',
    role: 'CONTRIBUTOR',
  };

  const userOther: AuthenticatedUser = {
    userId: '22222222-2222-2222-2222-222222222222',
    githubId: '67890',
    username: 'bob',
    role: 'CONTRIBUTOR',
  };

  const userMaintainer: AuthenticatedUser = {
    userId: '33333333-3333-3333-3333-333333333333',
    githubId: '99999',
    username: 'charlie-admin',
    role: 'MAINTAINER',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReputationController],
      providers: [
        {
          provide: ReputationService,
          useValue: mockReputationService,
        },
      ],
    }).compile();

    controller = module.get<ReputationController>(ReputationController);
    service = module.get<ReputationService>(ReputationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET :userId (latest)', () => {
    it('allows public access without authentication or ownership check', async () => {
      const mockSnapshot = {
        id: 'snap-1',
        userId: userOwner.userId,
        completionRate: 0.95,
        lifetimeEarnings: '500.00',
      };
      mockReputationService.getLatest.mockResolvedValue(mockSnapshot);

      const result = await controller.latest(userOwner.userId);

      expect(result).toEqual(mockSnapshot);
      expect(mockReputationService.getLatest).toHaveBeenCalledWith(userOwner.userId);
    });
  });

  describe('GET :userId/history', () => {
    it('allows public access to historical snapshots with pagination', async () => {
      const mockHistory = {
        data: [{ id: 'snap-1', completionRate: 0.95 }],
        total: 1,
      };
      mockReputationService.history.mockResolvedValue(mockHistory);

      const result = await controller.history(userOwner.userId, '10', '0');

      expect(result).toEqual(mockHistory);
      expect(mockReputationService.history).toHaveBeenCalledWith(userOwner.userId, {
        limit: 10,
        offset: 0,
      });
    });
  });

  describe('POST :userId/recompute', () => {
    it('allows the owner to trigger on-demand recomputation', async () => {
      const mockResult = { id: 'snap-2', completionRate: 1.0 };
      mockReputationService.computeAndSave.mockResolvedValue(mockResult);

      const result = await controller.recompute(userOwner.userId, userOwner);

      expect(result).toEqual(mockResult);
      expect(mockReputationService.computeAndSave).toHaveBeenCalledWith(userOwner.userId);
    });

    it('allows a MAINTAINER to trigger recomputation for any contributor', async () => {
      const mockResult = { id: 'snap-3', completionRate: 1.0 };
      mockReputationService.computeAndSave.mockResolvedValue(mockResult);

      const result = await controller.recompute(userOwner.userId, userMaintainer);

      expect(result).toEqual(mockResult);
      expect(mockReputationService.computeAndSave).toHaveBeenCalledWith(userOwner.userId);
    });

    it('throws ForbiddenException if another non-maintainer contributor tries to recompute', async () => {
      expect(() => controller.recompute(userOwner.userId, userOther)).toThrow(
        ForbiddenException,
      );
      expect(mockReputationService.computeAndSave).not.toHaveBeenCalled();
    });
  });
});
