import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { BountiesService } from './bounties.service';
import { BountyExpiryScheduler } from './bounty-expiry.scheduler';

describe('BountyExpiryScheduler', () => {
  let scheduler: BountyExpiryScheduler;
  let bountiesService: { expireOverdue: jest.Mock };
  let queryRunner: {
    connect: jest.Mock;
    query: jest.Mock;
    release: jest.Mock;
  };
  let dataSource: { createQueryRunner: jest.Mock };

  beforeEach(async () => {
    bountiesService = { expireOverdue: jest.fn() };
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      // First query acquires the advisory lock, second releases it.
      query: jest
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValue([{ unlocked: true }]),
      release: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BountyExpiryScheduler,
        { provide: BountiesService, useValue: bountiesService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    scheduler = module.get(BountyExpiryScheduler);
  });

  it('calls expireOverdue exactly once', async () => {
    bountiesService.expireOverdue.mockResolvedValue(0);
    await scheduler.sweepOverdueBounties();
    expect(bountiesService.expireOverdue).toHaveBeenCalledTimes(1);
  });

  it('logs when expired count is non-zero', async () => {
    bountiesService.expireOverdue.mockResolvedValue(3);
    const loggerSpy = jest
      .spyOn(scheduler['logger'], 'log')
      .mockImplementation();

    await scheduler.sweepOverdueBounties();

    expect(loggerSpy).toHaveBeenCalledWith('Expired 3 overdue bounty(ies)');
  });

  it('does not log when expired count is zero', async () => {
    bountiesService.expireOverdue.mockResolvedValue(0);
    const loggerSpy = jest
      .spyOn(scheduler['logger'], 'log')
      .mockImplementation();

    await scheduler.sweepOverdueBounties();

    expect(loggerSpy).not.toHaveBeenCalled();
  });

  it('skips the sweep when another replica holds the advisory lock (#586)', async () => {
    queryRunner.query.mockReset().mockResolvedValue([{ locked: false }]);

    await scheduler.sweepOverdueBounties();

    expect(bountiesService.expireOverdue).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('releases the advisory lock even when the sweep throws', async () => {
    bountiesService.expireOverdue.mockRejectedValue(new Error('db gone'));

    await expect(scheduler.sweepOverdueBounties()).rejects.toThrow('db gone');

    const calls = queryRunner.query.mock.calls.map((c) => String(c[0]));
    expect(calls.some((q) => q.includes('pg_advisory_unlock'))).toBe(true);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
