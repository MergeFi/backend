import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { BountiesService } from './bounties.service';
import { BountyExpiryScheduler } from './bounty-expiry.scheduler';

describe('BountyExpiryScheduler advisory lock (#785)', () => {
  let scheduler: BountyExpiryScheduler;
  let bountiesService: { expireOverdue: jest.Mock };
  let dataSource: { isInitialized: boolean; createQueryRunner: jest.Mock };

  beforeEach(async () => {
    bountiesService = { expireOverdue: jest.fn().mockResolvedValue(0) };
    dataSource = {
      isInitialized: true,
      createQueryRunner: jest.fn(() => {
        throw new Error('connection terminated');
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BountyExpiryScheduler,
        { provide: BountiesService, useValue: bountiesService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue({ enabled: true }) },
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    scheduler = module.get(BountyExpiryScheduler);
  });

  it('skips the sweep and does not throw when the lock query fails', async () => {
    await expect(scheduler.sweepOverdueBounties()).resolves.toBeUndefined();

    expect(dataSource.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(bountiesService.expireOverdue).not.toHaveBeenCalled();
  });
});
