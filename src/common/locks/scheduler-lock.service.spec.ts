import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  SchedulerLockId,
  SchedulerLockService,
} from './scheduler-lock.service';

describe('SchedulerLockService', () => {
  let service: SchedulerLockService;
  let mockQueryRunner: {
    connect: jest.Mock;
    query: jest.Mock;
    release: jest.Mock;
  };
  let mockDataSource: {
    isInitialized: boolean;
    createQueryRunner: jest.Mock;
  };
  let mockConfigService: {
    get: jest.Mock;
  };
  const originalEnv = process.env.RUN_SCHEDULERS;

  beforeEach(() => {
    delete process.env.RUN_SCHEDULERS;

    mockQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };

    mockDataSource = {
      isInitialized: true,
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    mockConfigService = {
      get: jest.fn(),
    };

    service = new SchedulerLockService(
      mockDataSource as unknown as DataSource,
      mockConfigService as unknown as ConfigService,
    );
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.RUN_SCHEDULERS = originalEnv;
    } else {
      delete process.env.RUN_SCHEDULERS;
    }
  });

  describe('when schedulers are disabled', () => {
    it('skips execution when runSchedulers is false in configService', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'runSchedulers') return false;
        return undefined;
      });

      const fn = jest.fn();
      const result = await service.withSchedulerLock(
        SchedulerLockId.BOUNTY_EXPIRY,
        'sweep',
        fn,
      );

      expect(result).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();
      expect(mockDataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('skips execution when RUN_SCHEDULERS is "false" in configService', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'RUN_SCHEDULERS') return 'false';
        return undefined;
      });

      const fn = jest.fn();
      await service.withSchedulerLock(
        SchedulerLockId.IDEMPOTENCY_CLEANUP,
        'cleanup',
        fn,
      );

      expect(fn).not.toHaveBeenCalled();
    });

    it('skips execution when RUN_SCHEDULERS is "0" in configService', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'RUN_SCHEDULERS') return '0';
        return undefined;
      });

      const fn = jest.fn();
      await service.withSchedulerLock(
        SchedulerLockId.BOUNTY_EXPIRY,
        'sweep',
        fn,
      );

      expect(fn).not.toHaveBeenCalled();
    });

    it('skips execution when RUN_SCHEDULERS is "false" in process.env without configService', async () => {
      process.env.RUN_SCHEDULERS = 'false';
      const noConfigService = new SchedulerLockService(
        mockDataSource as unknown as DataSource,
      );

      const fn = jest.fn();
      await noConfigService.withSchedulerLock(
        SchedulerLockId.BOUNTY_EXPIRY,
        'sweep',
        fn,
      );

      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('when dataSource is not available or not initialized', () => {
    it('runs fn directly when dataSource is undefined', async () => {
      const standalone = new SchedulerLockService();
      const fn = jest.fn().mockResolvedValue('direct-result');

      const result = await standalone.withSchedulerLock(
        SchedulerLockId.BOUNTY_EXPIRY,
        'sweep',
        fn,
      );

      expect(result).toBe('direct-result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('runs fn directly when dataSource.isInitialized is false', async () => {
      mockDataSource = {
        isInitialized: false,
        createQueryRunner: jest.fn(),
      };
      service = new SchedulerLockService(
        mockDataSource as unknown as DataSource,
      );

      const fn = jest.fn().mockResolvedValue('direct-result');
      const result = await service.withSchedulerLock(
        SchedulerLockId.BOUNTY_EXPIRY,
        'sweep',
        fn,
      );

      expect(result).toBe('direct-result');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockDataSource.createQueryRunner).not.toHaveBeenCalled();
    });
  });

  describe('lock acquisition on dedicated QueryRunner', () => {
    it('acquires lock, executes fn, releases lock on same queryRunner, and releases queryRunner', async () => {
      mockQueryRunner.query.mockImplementation(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return [{ acquired: true }];
        }
        if (sql.includes('pg_advisory_unlock')) {
          return [{ unlocked: true }];
        }
        return [];
      });

      const fn = jest.fn().mockResolvedValue('task-done');
      const result = await service.withSchedulerLock(
        SchedulerLockId.BOUNTY_EXPIRY,
        'sweep',
        fn,
      );

      expect(result).toBe('task-done');
      expect(mockDataSource.createQueryRunner).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.connect).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.query).toHaveBeenNthCalledWith(
        1,
        'SELECT pg_try_advisory_lock($1) as acquired',
        [SchedulerLockId.BOUNTY_EXPIRY],
      );
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.query).toHaveBeenNthCalledWith(
        2,
        'SELECT pg_advisory_unlock($1)',
        [SchedulerLockId.BOUNTY_EXPIRY],
      );
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('fails closed when lock is held by another instance', async () => {
      mockQueryRunner.query.mockResolvedValueOnce([{ acquired: false }]);
      const debugSpy = jest
        .spyOn(service['logger'], 'debug')
        .mockImplementation();

      const fn = jest.fn();
      const result = await service.withSchedulerLock(
        SchedulerLockId.BOUNTY_EXPIRY,
        'sweep',
        fn,
      );

      expect(result).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(
        'Skipping sweep: another instance holds advisory lock',
      );
      // Must not unlock lock it did not acquire
      expect(mockQueryRunner.query).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('fails closed when lock query throws an error', async () => {
      mockQueryRunner.query.mockRejectedValueOnce(
        new Error('database connection lost'),
      );
      const errorSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation();

      const fn = jest.fn();
      const result = await service.withSchedulerLock(
        SchedulerLockId.IDEMPOTENCY_CLEANUP,
        'cleanup',
        fn,
      );

      expect(result).toBeUndefined();
      expect(fn).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('releases lock and queryRunner even when fn throws', async () => {
      mockQueryRunner.query.mockImplementation(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return [{ acquired: true }];
        }
        if (sql.includes('pg_advisory_unlock')) {
          return [{ unlocked: true }];
        }
        return [];
      });

      const fn = jest.fn().mockRejectedValue(new Error('sweep failed'));

      await expect(
        service.withSchedulerLock(SchedulerLockId.BOUNTY_EXPIRY, 'sweep', fn),
      ).rejects.toThrow('sweep failed');

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1)',
        [SchedulerLockId.BOUNTY_EXPIRY],
      );
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });
  });
});
