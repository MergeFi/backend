import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('ReputationController', () => {
  let controller: ReputationController;
  let reputationService: {
    computeAndSave: jest.Mock;
    getLatest: jest.Mock;
    history: jest.Mock;
  };

  const selfUser: AuthenticatedUser = {
    userId: 'user-self',
    login: 'self-user',
    roles: [],
  };

  const otherUser: AuthenticatedUser = {
    userId: 'user-other',
    login: 'other-user',
    roles: [],
  };

  beforeEach(async () => {
    reputationService = {
      computeAndSave: jest.fn().mockResolvedValue({ score: 120 }),
      getLatest: jest.fn().mockResolvedValue({ score: 100 }),
      history: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReputationController],
      providers: [{ provide: ReputationService, useValue: reputationService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ReputationController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('recompute', () => {
    it('throws ForbiddenException when user recomputes reputation for another user', () => {
      expect(() => controller.recompute('user-self', otherUser)).toThrow(
        ForbiddenException,
      );
      expect(reputationService.computeAndSave).not.toHaveBeenCalled();
    });

    it('delegates recomputation to reputationService for owner', async () => {
      const result = await controller.recompute('user-self', selfUser);

      expect(reputationService.computeAndSave).toHaveBeenCalledWith(
        'user-self',
      );
      expect(result).toEqual({ score: 120 });
    });
  });

  describe('latest', () => {
    it('throws ForbiddenException when requesting another user reputation', () => {
      expect(() => controller.latest('user-self', otherUser)).toThrow(
        ForbiddenException,
      );
      expect(reputationService.getLatest).not.toHaveBeenCalled();
    });

    it('delegates to reputationService.getLatest for owner', async () => {
      const result = await controller.latest('user-self', selfUser);

      expect(reputationService.getLatest).toHaveBeenCalledWith('user-self');
      expect(result).toEqual({ score: 100 });
    });
  });

  describe('history', () => {
    it('throws ForbiddenException when querying another user history', () => {
      expect(() =>
        controller.history('user-self', otherUser, '10', '0'),
      ).toThrow(ForbiddenException);
      expect(reputationService.history).not.toHaveBeenCalled();
    });

    it('parses limit and offset strings into integers and forwards to service', async () => {
      const result = await controller.history(
        'user-self',
        selfUser,
        '25',
        '50',
      );

      expect(reputationService.history).toHaveBeenCalledWith('user-self', {
        limit: 25,
        offset: 50,
      });
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('handles undefined or invalid query parameters gracefully', async () => {
      await controller.history('user-self', selfUser, undefined, 'invalid');

      expect(reputationService.history).toHaveBeenCalledWith('user-self', {
        limit: undefined,
        offset: undefined,
      });
    });
  });
});
