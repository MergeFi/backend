import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SponsorsController, validatePage } from './sponsors.controller';
import { SponsorsService } from './sponsors.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';

describe('SponsorsController', () => {
  let controller: SponsorsController;
  let sponsorsService: {
    dashboard: jest.Mock;
    milestoneProgress: jest.Mock;
  };

  const userAlice: AuthenticatedUser = {
    userId: 'sponsor-1',
    username: 'alice',
    roles: [UserRole.SPONSOR],
  };

  const userBob: AuthenticatedUser = {
    userId: 'sponsor-2',
    username: 'bob',
    roles: [UserRole.SPONSOR],
  };

  beforeEach(async () => {
    sponsorsService = {
      dashboard: jest.fn().mockResolvedValue({ id: 'dashboard-data' }),
      milestoneProgress: jest.fn().mockResolvedValue({ id: 'progress-data' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SponsorsController],
      providers: [{ provide: SponsorsService, useValue: sponsorsService }],
    }).compile();

    controller = module.get(SponsorsController);
  });

  describe('dashboard', () => {
    it('returns dashboard data for the owner', async () => {
      const res = await controller.dashboard('sponsor-1', userAlice, 10, 0);
      expect(res).toEqual({ id: 'dashboard-data' });
      expect(sponsorsService.dashboard).toHaveBeenCalledWith('sponsor-1', {
        limit: 10,
        offset: 0,
      });
    });

    it('throws 403 ForbiddenException when accessing another sponsor dashboard', async () => {
      expect(() =>
        controller.dashboard('sponsor-1', userBob, 10, 0),
      ).toThrow(ForbiddenException);
      expect(sponsorsService.dashboard).not.toHaveBeenCalled();
    });
  });

  describe('milestoneProgress', () => {
    it('returns milestone progress for the owner', async () => {
      const res = await controller.milestoneProgress(
        'sponsor-1',
        userAlice,
        20,
        5,
      );
      expect(res).toEqual({ id: 'progress-data' });
      expect(sponsorsService.milestoneProgress).toHaveBeenCalledWith(
        'sponsor-1',
        { limit: 20, offset: 5 },
      );
    });

    it('throws 403 ForbiddenException when accessing another sponsor milestone progress', async () => {
      expect(() =>
        controller.milestoneProgress('sponsor-1', userBob, 20, 5),
      ).toThrow(ForbiddenException);
      expect(sponsorsService.milestoneProgress).not.toHaveBeenCalled();
    });
  });

  describe('validatePage', () => {
    it('accepts valid limit and offset', () => {
      expect(validatePage(25, 10)).toEqual({ limit: 25, offset: 10 });
    });

    it('throws BadRequestException for negative offset', () => {
      expect(() => validatePage(10, -1)).toThrow(BadRequestException);
    });

    it('throws BadRequestException for limit > MAX_PAGE_LIMIT', () => {
      expect(() => validatePage(101, 0)).toThrow(BadRequestException);
    });

    it('throws BadRequestException for limit < 1', () => {
      expect(() => validatePage(0, 0)).toThrow(BadRequestException);
    });
  });
});
