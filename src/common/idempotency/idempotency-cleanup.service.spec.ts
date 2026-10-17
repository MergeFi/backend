import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, LessThan } from 'typeorm';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
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

    // The DataSource mock answers the advisory-lock query with locked:true
    // so the single-runner guard passes and the sweep runs (#586).
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn(),
        query: jest.fn().mockResolvedValue([{ locked: true }]),
        release: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyCleanupService,
        { provide: getRepositoryToken(IdempotencyKey), useValue: repo },
        { provide: DataSource, useValue: dataSource },
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
});
