import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThan } from 'typeorm';
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
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    configService = { get: jest.fn().mockReturnValue({ enabled: true }) };
    repo = {
      delete: jest
        .fn<Promise<{ affected: number }>, [DeleteCriteria]>()
        .mockResolvedValue({ affected: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyCleanupService,
        { provide: getRepositoryToken(IdempotencyKey), useValue: repo },
        { provide: ConfigService, useValue: configService },
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

  it('skips cleanup when schedulers are disabled (RUN_SCHEDULERS)', async () => {
    configService.get.mockReturnValue({ enabled: false });

    await service.removeExpired();

    expect(configService.get).toHaveBeenCalledWith('schedulers', {
      infer: true,
    });
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
