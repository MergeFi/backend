import { Test, TestingModule } from '@nestjs/testing';
import { MaintenancePoolController } from './maintenance-pool.controller';
import { MaintenancePoolService } from './maintenance-pool.service';
import { Request } from 'express';

describe('MaintenancePoolController', () => {
  let controller: MaintenancePoolController;
  let poolService: {
    create: jest.Mock;
    list: jest.Mock;
    findOne: jest.Mock;
    deposit: jest.Mock;
    assignReward: jest.Mock;
  };

  beforeEach(async () => {
    poolService = {
      create: jest.fn().mockResolvedValue({ id: 'pool-1' }),
      list: jest.fn().mockResolvedValue([{ id: 'pool-1' }]),
      findOne: jest.fn().mockResolvedValue({ id: 'pool-1' }),
      deposit: jest.fn().mockResolvedValue({ id: 'pool-1' }),
      assignReward: jest.fn().mockResolvedValue({ id: 'pool-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MaintenancePoolController],
      providers: [{ provide: MaintenancePoolService, useValue: poolService }],
    }).compile();

    controller = module.get(MaintenancePoolController);
  });

  it('delegates create to poolService with caller userId', async () => {
    const req = { user: { userId: 'user-1' } } as unknown as Request;
    const dto = { repositoryId: 'repo-1', targetAmount: '100' } as any;

    const res = await controller.create(dto, req);
    expect(res).toEqual({ id: 'pool-1' });
    expect(poolService.create).toHaveBeenCalledWith(dto, 'user-1');
  });

  it('delegates list to poolService', async () => {
    const res = await controller.list();
    expect(res).toEqual([{ id: 'pool-1' }]);
    expect(poolService.list).toHaveBeenCalled();
  });

  it('delegates findOne to poolService', async () => {
    const res = await controller.findOne('pool-1');
    expect(res).toEqual({ id: 'pool-1' });
    expect(poolService.findOne).toHaveBeenCalledWith('pool-1');
  });

  it('delegates deposit to poolService', async () => {
    const res = await controller.deposit('pool-1', {
      amount: '50.00',
      funderAddress: 'GFUNDER',
    });
    expect(res).toEqual({ id: 'pool-1' });
    expect(poolService.deposit).toHaveBeenCalledWith('pool-1', '50.00', 'GFUNDER');
  });

  it('delegates assignReward to poolService', async () => {
    const res = await controller.assignReward('pool-1', {
      issueId: 'issue-1',
      amount: '20.00',
      recipientAddress: 'GRECIPIENT',
      recipientId: 'user-2',
    });
    expect(res).toEqual({ id: 'pool-1' });
    expect(poolService.assignReward).toHaveBeenCalledWith(
      'pool-1',
      'issue-1',
      '20.00',
      'GRECIPIENT',
      'user-2',
    );
  });
});
