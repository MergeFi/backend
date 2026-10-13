import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SponsorsController } from './sponsors.controller';
import { SponsorsService } from './sponsors.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('SponsorsController', () => {
  let controller: SponsorsController;
  let sponsorsService: {
    dashboard: jest.Mock;
    milestoneProgress: jest.Mock;
  };

  const sponsorUser: AuthenticatedUser = {
    userId: 'sponsor-1',
    login: 'sponsor-user',
    roles: [],
  };

  const otherUser: AuthenticatedUser = {
    userId: 'sponsor-other',
    login: 'other-user',
    roles: [],
  };

  beforeEach(async () => {
    sponsorsService = {
      dashboard: jest.fn().mockResolvedValue({ totalSponsored: '1000' }),
      milestoneProgress: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SponsorsController],
      providers: [{ provide: SponsorsService, useValue: sponsorsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(SponsorsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('dashboard', () => {
    it('throws ForbiddenException when requesting dashboard of another sponsor', () => {
      expect(() => controller.dashboard('sponsor-1', otherUser, 20, 0)).toThrow(
        ForbiddenException,
      );
      expect(sponsorsService.dashboard).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when limit is less than 1 or exceeds 100', () => {
      expect(() =>
        controller.dashboard('sponsor-1', sponsorUser, 0, 0),
      ).toThrow(BadRequestException);

      expect(() =>
        controller.dashboard('sponsor-1', sponsorUser, 101, 0),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when offset is negative', () => {
      expect(() =>
        controller.dashboard('sponsor-1', sponsorUser, 20, -1),
      ).toThrow(BadRequestException);
    });

    it('forwards valid pagination to sponsorsService.dashboard', async () => {
      const result = await controller.dashboard(
        'sponsor-1',
        sponsorUser,
        25,
        10,
      );

      expect(sponsorsService.dashboard).toHaveBeenCalledWith('sponsor-1', {
        limit: 25,
        offset: 10,
      });
      expect(result).toEqual({ totalSponsored: '1000' });
    });
  });

  describe('milestoneProgress', () => {
    it('throws ForbiddenException when requesting progress of another sponsor', () => {
      expect(() =>
        controller.milestoneProgress('sponsor-1', otherUser, 20, 0),
      ).toThrow(ForbiddenException);
      expect(sponsorsService.milestoneProgress).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when pagination is invalid', () => {
      expect(() =>
        controller.milestoneProgress('sponsor-1', sponsorUser, 150, 0),
      ).toThrow(BadRequestException);

      expect(() =>
        controller.milestoneProgress('sponsor-1', sponsorUser, 10, -5),
      ).toThrow(BadRequestException);
    });

    it('forwards valid pagination to sponsorsService.milestoneProgress', async () => {
      const result = await controller.milestoneProgress(
        'sponsor-1',
        sponsorUser,
        30,
        0,
      );

      expect(sponsorsService.milestoneProgress).toHaveBeenCalledWith(
        'sponsor-1',
        {
          limit: 30,
          offset: 0,
        },
      );
      expect(result).toEqual({ items: [], total: 0 });
    });
  });
});
