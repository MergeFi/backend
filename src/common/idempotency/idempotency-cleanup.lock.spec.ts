import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';

describe('IdempotencyCleanupService advisory lock (#785)', () => {
  let service: IdempotencyCleanupService;
  let repo: { delete: jest.Mock };
  let dataSource: { isInitialized: boolean; createQueryRunner: jest.Mock };

  beforeEach(async () => {
    repo = { delete: jest.fn().mockResolvedValue({ affected: 0 }) };
    dataSource = {
      isInitialized: true,
      createQueryRunner: jest.fn(() => {
        throw new Error('connection terminated');
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyCleanupService,
        { provide: getRepositoryToken(IdempotencyKey), useValue: repo },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue({ enabled: true }) },
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(IdempotencyCleanupService);
  });

  it('skips the cleanup and does not throw when the lock query fails', async () => {
    await expect(service.removeExpired()).resolves.toBeUndefined();

    expect(dataSource.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
