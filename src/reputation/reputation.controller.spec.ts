import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReputationSnapshot } from '../common/entities';

describe('ReputationController (#585, #596)', () => {
  let controller: ReputationController;
  let reputationService: {
    computeAndSave: jest.Mock;
    getLatest: jest.Mock;
    history: jest.Mock;
  };

  const sampleSnapshot: Partial<ReputationSnapshot> = {
    id: 'snap-1',
    userId: '00000000-0000-0000-0000-000000000001',
    totalEarnings: '100.0000000',
    mergedPrCount: 5,
    completionRate: '100.00',
    computedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    reputationService = {
      computeAndSave: jest.fn().mockResolvedValue(sampleSnapshot),
      getLatest: jest.fn().mockResolvedValue(sampleSnapshot),
      history: jest
        .fn()
        .mockResolvedValue({ items: [sampleSnapshot], total: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReputationController],
      providers: [{ provide: ReputationService, useValue: reputationService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReputationController>(ReputationController);
  });

  describe('guard metadata (#596)', () => {
    const handlerFor = (name: string) =>
      (
        ReputationController.prototype as unknown as Record<
          string,
          (...args: unknown[]) => unknown
        >
      )[name];

    it('recompute is protected by JwtAuthGuard', () => {
      const guards = Reflect.getMetadata('__guards__', handlerFor('recompute'));
      expect(guards).toEqual([JwtAuthGuard]);
    });

    it('latest is protected by JwtAuthGuard', () => {
      const guards = Reflect.getMetadata('__guards__', handlerFor('latest'));
      expect(guards).toEqual([JwtAuthGuard]);
    });

    it('history is protected by JwtAuthGuard', () => {
      const guards = Reflect.getMetadata('__guards__', handlerFor('history'));
      expect(guards).toEqual([JwtAuthGuard]);
    });
  });

  describe('ownership authorization (assertOwner)', () => {
    const targetUserId = '00000000-0000-0000-0000-000000000001';
    const attackerCaller = {
      userId: '00000000-0000-0000-0000-000000000002',
      username: 'mallory',
    };

    it('recompute throws ForbiddenException for cross-user requests', () => {
      expect(() => controller.recompute(targetUserId, attackerCaller)).toThrow(
        ForbiddenException,
      );
      expect(reputationService.computeAndSave).not.toHaveBeenCalled();
    });

    it('latest throws ForbiddenException for cross-user requests', () => {
      expect(() => controller.latest(targetUserId, attackerCaller)).toThrow(
        ForbiddenException,
      );
      expect(reputationService.getLatest).not.toHaveBeenCalled();
    });

    it('history throws ForbiddenException for cross-user requests', () => {
      expect(() =>
        controller.history(targetUserId, attackerCaller, '10', '0', 'DESC'),
      ).toThrow(ForbiddenException);
      expect(reputationService.history).not.toHaveBeenCalled();
    });
  });

  describe('successful execution & query parsing', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const ownerCaller = { userId, username: 'alice' };

    it('recompute delegates to reputationService.computeAndSave', async () => {
      const result = await controller.recompute(userId, ownerCaller);
      expect(reputationService.computeAndSave).toHaveBeenCalledWith(userId);
      expect(result).toEqual(sampleSnapshot);
    });

    it('latest delegates to reputationService.getLatest', async () => {
      const result = await controller.latest(userId, ownerCaller);
      expect(reputationService.getLatest).toHaveBeenCalledWith(userId);
      expect(result).toEqual(sampleSnapshot);
    });

    it('history parses limit, offset, and order query parameters (#585)', async () => {
      const result = await controller.history(
        userId,
        ownerCaller,
        '25',
        '50',
        'ASC',
      );

      expect(reputationService.history).toHaveBeenCalledWith(userId, {
        limit: 25,
        offset: 50,
        order: 'ASC',
      });
      expect(result).toEqual({ items: [sampleSnapshot], total: 1 });
    });

    it('history handles missing query parameters and defaults order to undefined', async () => {
      await controller.history(
        userId,
        ownerCaller,
        undefined,
        undefined,
        undefined,
      );

      expect(reputationService.history).toHaveBeenCalledWith(userId, {
        limit: undefined,
        offset: undefined,
        order: undefined,
      });
    });
  });
});
