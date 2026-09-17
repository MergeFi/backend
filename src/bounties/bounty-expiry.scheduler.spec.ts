import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { BountyExpiryScheduler } from './bounty-expiry.scheduler';
import { BountiesService } from './bounties.service';

describe('BountyExpiryScheduler', () => {
  let scheduler: BountyExpiryScheduler;
  let bountiesService: {
    expireOverdue: jest.Mock<Promise<number>, []>;
  };
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    bountiesService = {
      expireOverdue: jest.fn<Promise<number>, []>().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BountyExpiryScheduler,
        { provide: BountiesService, useValue: bountiesService },
      ],
    }).compile();

    scheduler = module.get(BountyExpiryScheduler);
    loggerLogSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    loggerLogSpy.mockRestore();
  });

  it('calls BountiesService.expireOverdue during sweep', async () => {
    bountiesService.expireOverdue.mockResolvedValue(0);

    await scheduler.sweepOverdueBounties();

    expect(bountiesService.expireOverdue).toHaveBeenCalledTimes(1);
    expect(loggerLogSpy).not.toHaveBeenCalled();
  });

  it('logs when one or more overdue bounties are expired', async () => {
    bountiesService.expireOverdue.mockResolvedValue(3);

    await scheduler.sweepOverdueBounties();

    expect(bountiesService.expireOverdue).toHaveBeenCalledTimes(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(
      'Expired 3 overdue bounty(ies)',
    );
  });

  it('does not log when zero bounties are expired', async () => {
    bountiesService.expireOverdue.mockResolvedValue(0);

    await scheduler.sweepOverdueBounties();

    expect(bountiesService.expireOverdue).toHaveBeenCalledTimes(1);
    expect(loggerLogSpy).not.toHaveBeenCalled();
  });
});
