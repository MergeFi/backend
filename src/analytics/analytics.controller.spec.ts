import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: {
    forContributor: jest.Mock;
    platformSummary: jest.Mock;
  };

  const userAlice: AuthenticatedUser = {
    userId: 'user-1',
    username: 'alice',
    roles: [UserRole.CONTRIBUTOR],
  };

  const userBob: AuthenticatedUser = {
    userId: 'user-2',
    username: 'bob',
    roles: [UserRole.CONTRIBUTOR],
  };

  beforeEach(async () => {
    analyticsService = {
      forContributor: jest.fn().mockResolvedValue({ userId: 'user-1' }),
      platformSummary: jest.fn().mockResolvedValue({ totalBounties: 10 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: analyticsService }],
    }).compile();

    controller = module.get(AnalyticsController);
  });

  describe('forContributor', () => {
    it('returns analytics for the user', async () => {
      const res = await controller.forContributor(
        'user-1',
        userAlice,
        '2024-01-01',
        '2024-06-01',
      );
      expect(res).toEqual({ userId: 'user-1' });
      expect(analyticsService.forContributor).toHaveBeenCalledWith('user-1', {
        from: '2024-01-01',
        to: '2024-06-01',
      });
    });

    it('throws 403 ForbiddenException when accessing another contributor analytics', async () => {
      expect(() =>
        controller.forContributor('user-1', userBob, undefined, undefined),
      ).toThrow(ForbiddenException);
      expect(analyticsService.forContributor).not.toHaveBeenCalled();
    });
  });

  describe('platformSummary', () => {
    it('returns platform-wide analytics summary', async () => {
      const res = await controller.platformSummary();
      expect(res).toEqual({ totalBounties: 10 });
      expect(analyticsService.platformSummary).toHaveBeenCalled();
    });
  });
});
