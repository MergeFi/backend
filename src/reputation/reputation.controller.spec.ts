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
    getOrComputeLatest: jest.Mock;
    history: jest.Mock;
  };

  const mockUser: AuthenticatedUser = {
    userId: 'user-1',
    username: 'contributor1',
  };

  beforeEach(async () => {
    reputationService = {
      computeAndSave: jest
        .fn()
        .mockResolvedValue({ id: 'snap-1', userId: 'user-1' }),
      getLatest: jest
        .fn()
        .mockResolvedValue({ id: 'snap-1', userId: 'user-1' }),
      getOrComputeLatest: jest
        .fn()
        .mockResolvedValue({ id: 'snap-1', userId: 'user-1' }),
      history: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReputationController],
      providers: [
        {
          provide: ReputationService,
          useValue: reputationService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReputationController>(ReputationController);
  });

  describe('recompute', () => {
    it('calls computeAndSave when caller is owner', async () => {
      const result = await controller.recompute('user-1', mockUser);

      expect(reputationService.computeAndSave).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ id: 'snap-1', userId: 'user-1' });
    });

    it('throws ForbiddenException when caller is not owner', () => {
      expect(() => controller.recompute('other-user', mockUser)).toThrow(
        ForbiddenException,
      );
      expect(reputationService.computeAndSave).not.toHaveBeenCalled();
    });
  });

  describe('latest', () => {
    it('calls getOrComputeLatest when caller is owner', async () => {
      const result = await controller.latest('user-1', mockUser);

      expect(reputationService.getOrComputeLatest).toHaveBeenCalledWith(
        'user-1',
      );
      expect(result).toEqual({ id: 'snap-1', userId: 'user-1' });
    });

    it('throws ForbiddenException when caller is not owner', () => {
      expect(() => controller.latest('other-user', mockUser)).toThrow(
        ForbiddenException,
      );
      expect(reputationService.getOrComputeLatest).not.toHaveBeenCalled();
    });
  });

  describe('history', () => {
    it('calls history with parsed limit and offset', async () => {
      const result = await controller.history('user-1', mockUser, '20', '5');

      expect(reputationService.history).toHaveBeenCalledWith('user-1', {
        limit: 20,
        offset: 5,
      });
      expect(result).toEqual([]);
    });

    it('throws ForbiddenException when caller is not owner', () => {
      expect(() => controller.history('other-user', mockUser)).toThrow(
        ForbiddenException,
      );
      expect(reputationService.history).not.toHaveBeenCalled();
    });
  });
});
