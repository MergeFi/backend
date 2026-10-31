import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums';

describe('ReputationController', () => {
  let controller: ReputationController;
  let reputationService: {
    computeAndSave: jest.Mock;
    getLatest: jest.Mock;
    history: jest.Mock;
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
    reputationService = {
      computeAndSave: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
      getLatest: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
      history: jest.fn().mockResolvedValue([{ id: 'snapshot-1' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReputationController],
      providers: [{ provide: ReputationService, useValue: reputationService }],
    }).compile();

    controller = module.get(ReputationController);
  });

  describe('recompute', () => {
    it('allows owner to recompute reputation', async () => {
      const res = await controller.recompute('user-1', userAlice);
      expect(res).toEqual({ id: 'snapshot-1' });
      expect(reputationService.computeAndSave).toHaveBeenCalledWith('user-1');
    });

    it('throws 403 ForbiddenException when caller is not owner', async () => {
      expect(() => controller.recompute('user-1', userBob)).toThrow(
        ForbiddenException,
      );
      expect(reputationService.computeAndSave).not.toHaveBeenCalled();
    });
  });

  describe('latest', () => {
    it('returns latest snapshot for owner', async () => {
      const res = await controller.latest('user-1', userAlice);
      expect(res).toEqual({ id: 'snapshot-1' });
      expect(reputationService.getLatest).toHaveBeenCalledWith('user-1');
    });

    it('throws 403 ForbiddenException when caller is not owner', async () => {
      expect(() => controller.latest('user-1', userBob)).toThrow(
        ForbiddenException,
      );
      expect(reputationService.getLatest).not.toHaveBeenCalled();
    });
  });

  describe('history', () => {
    it('returns history for owner with parsed pagination', async () => {
      const res = await controller.history('user-1', userAlice, '20', '10');
      expect(res).toEqual([{ id: 'snapshot-1' }]);
      expect(reputationService.history).toHaveBeenCalledWith('user-1', {
        limit: 20,
        offset: 10,
      });
    });

    it('throws 403 ForbiddenException when caller is not owner', async () => {
      expect(() => controller.history('user-1', userBob)).toThrow(
        ForbiddenException,
      );
      expect(reputationService.history).not.toHaveBeenCalled();
    });
  });
});
