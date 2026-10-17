import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: {
    forContributor: jest.Mock;
    platformSummary: jest.Mock;
  };

  const selfUser: AuthenticatedUser = {
    userId: 'user-1',
    login: 'user-one',
    roles: [],
  };

  const otherUser: AuthenticatedUser = {
    userId: 'user-2',
    login: 'user-two',
    roles: [],
  };

  const mockContributorAnalytics = {
    totalEarned: '500',
    mergedPrs: 5,
    topSponsors: [],
  };

  const mockPlatformSummary = {
    totalBounties: 42,
    totalPaid: '15000',
  };

  beforeEach(async () => {
    analyticsService = {
      forContributor: jest.fn().mockResolvedValue(mockContributorAnalytics),
      platformSummary: jest.fn().mockResolvedValue(mockPlatformSummary),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: analyticsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AnalyticsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('forContributor', () => {
    it('throws ForbiddenException when querying analytics of another user', () => {
      expect(() =>
        controller.forContributor(
          'user-1',
          otherUser,
          '2026-01-01',
          '2026-06-01',
        ),
      ).toThrow(ForbiddenException);
      expect(analyticsService.forContributor).not.toHaveBeenCalled();
    });

    it('delegates to analyticsService.forContributor for owner with time range', async () => {
      const result = await controller.forContributor(
        'user-1',
        selfUser,
        '2026-01-01',
        '2026-06-01',
      );

      expect(analyticsService.forContributor).toHaveBeenCalledWith('user-1', {
        from: '2026-01-01',
        to: '2026-06-01',
      });
      expect(result).toBe(mockContributorAnalytics);
    });
  });

  describe('platformSummary', () => {
    it('delegates to analyticsService.platformSummary', async () => {
      const result = await controller.platformSummary();

      expect(analyticsService.platformSummary).toHaveBeenCalled();
      expect(result).toBe(mockPlatformSummary);
    });
  });
});
