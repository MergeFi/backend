import { Test, TestingModule } from '@nestjs/testing';
import { BountiesService } from './bounties.service';
import { BountyExpiryScheduler } from './bounty-expiry.scheduler';

describe('BountyExpiryScheduler', () => {
  let scheduler: BountyExpiryScheduler;
  let bountiesService: { expireOverdue: jest.Mock };

  beforeEach(async () => {
    bountiesService = { expireOverdue: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BountyExpiryScheduler,
        { provide: BountiesService, useValue: bountiesService },
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
});
