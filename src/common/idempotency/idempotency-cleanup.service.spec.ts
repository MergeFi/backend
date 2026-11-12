import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import {
  SchedulerLockId,
  SchedulerLockService,
} from '../locks/scheduler-lock.service';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';

interface DeleteCriteria {
  expiresAt: ReturnType<typeof LessThan>;
}

describe('IdempotencyCleanupService', () => {
  let service: IdempotencyCleanupService;
  let repo: {
    delete: jest.Mock<Promise<{ affected: number }>, [DeleteCriteria]>;
  };

  beforeEach(async () => {
    repo = {
      delete: jest
        .fn<Promise<{ affected: number }>, [DeleteCriteria]>()
        .mockResolvedValue({ affected: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyCleanupService,
        { provide: getRepositoryToken(IdempotencyKey), useValue: repo },
      ],
    }).compile();

    service = module.get(IdempotencyCleanupService);
  });

  it('deletes rows whose expiresAt has already passed', async () => {
    repo.delete.mockResolvedValue({ affected: 3 });

    await service.removeExpired();

    expect(repo.delete).toHaveBeenCalledTimes(1);
    const criteria = repo.delete.mock.calls[0][0];
    expect(criteria.expiresAt).toEqual(LessThan(expect.any(Date) as Date));
  });

  it('does not throw when nothing is expired', async () => {
    repo.delete.mockResolvedValue({ affected: 0 });

    await expect(service.removeExpired()).resolves.toBeUndefined();
  });

  it('delegates execution to schedulerLockService.withSchedulerLock with IDEMPOTENCY_CLEANUP', async () => {
    const mockLockService = {
      withSchedulerLock: jest
        .fn()
        .mockImplementation((_lockId, _name, fn) => fn()),
    };
    const serviceWithLock = new IdempotencyCleanupService(
      repo as unknown as Repository<IdempotencyKey>,
      mockLockService as unknown as SchedulerLockService,
    );
    repo.delete.mockResolvedValue({ affected: 2 });

    await serviceWithLock.removeExpired();

    expect(mockLockService.withSchedulerLock).toHaveBeenCalledWith(
      SchedulerLockId.IDEMPOTENCY_CLEANUP,
      'cleanup',
      expect.any(Function),
    );
    expect(repo.delete).toHaveBeenCalledTimes(1);
  });
});
