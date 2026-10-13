import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Reflector } from '@nestjs/core';
import { MaintenancePoolController } from './maintenance-pool.controller';
import { MaintenancePoolService } from './maintenance-pool.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { AssetType, MaintenancePoolStatus } from '../common/enums';
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

  const mockPool = {
    id: 'pool-1',
    name: 'Core Maintenance',
    repositoryId: 'repo-1',
    createdById: 'user-1',
    monthlyDeposit: '500',
    balance: '1500',
    asset: AssetType.USDC,
    status: MaintenancePoolStatus.ACTIVE,
  };

  beforeEach(async () => {
    poolService = {
      create: jest.fn().mockResolvedValue(mockPool),
      list: jest.fn().mockResolvedValue([mockPool]),
      findOne: jest.fn().mockResolvedValue(mockPool),
      deposit: jest.fn().mockResolvedValue(mockPool),
      assignReward: jest.fn().mockResolvedValue({ id: 'payment-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MaintenancePoolController],
      providers: [
        { provide: MaintenancePoolService, useValue: poolService },
        { provide: getRepositoryToken(IdempotencyKey), useValue: {} },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideInterceptor(IdempotencyInterceptor)
      .useValue({
        intercept: (_ctx: unknown, next: { handle: () => unknown }) =>
          next.handle(),
      })
      .compile();

    controller = module.get(MaintenancePoolController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('delegates creation to poolService with callerUserId', async () => {
      const dto = {
        name: 'Core Maintenance',
        repositoryId: 'repo-1',
        monthlyDeposit: '500',
        asset: AssetType.USDC,
      };
      const req = { user: { userId: 'user-1' } } as unknown as Request;

      const result = await controller.create(dto, req);

      expect(poolService.create).toHaveBeenCalledWith(dto, 'user-1');
      expect(result).toBe(mockPool);
    });
  });

  describe('list', () => {
    it('delegates to poolService.list', async () => {
      const result = await controller.list();

      expect(poolService.list).toHaveBeenCalled();
      expect(result).toEqual([mockPool]);
    });
  });

  describe('findOne', () => {
    it('delegates to poolService.findOne with UUID', async () => {
      const result = await controller.findOne('pool-1');

      expect(poolService.findOne).toHaveBeenCalledWith('pool-1');
      expect(result).toBe(mockPool);
    });
  });

  describe('deposit', () => {
    it('delegates deposit call to poolService', async () => {
      const dto = {
        amount: '250',
        funderAddress: 'GSPONSOR',
      };

      const result = await controller.deposit('pool-1', dto);

      expect(poolService.deposit).toHaveBeenCalledWith(
        'pool-1',
        '250',
        'GSPONSOR',
      );
      expect(result).toBe(mockPool);
    });
  });

  describe('assignReward', () => {
    it('delegates reward assignment to poolService', async () => {
      const dto = {
        issueId: 'issue-1',
        amount: '100',
        recipientAddress: 'GRECIPIENT',
        recipientId: 'user-2',
      };

      const result = await controller.assignReward('pool-1', dto);

      expect(poolService.assignReward).toHaveBeenCalledWith(
        'pool-1',
        'issue-1',
        '100',
        'GRECIPIENT',
        'user-2',
      );
      expect(result).toEqual({ id: 'payment-1' });
    });
  });
});
