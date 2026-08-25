import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaintenancePoolService } from './maintenance-pool.service';
import { MaintenancePool } from '../common/entities/maintenance-pool.entity';
import { EscrowService } from '../escrow/escrow.service';
import { Escrow } from '../common/entities/escrow.entity';
import { MaintenancePoolStatus, EscrowStatus } from '../common/enums';
import { NotFoundException, BadRequestException } from '@nestjs/common';

const mockPoolRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
};

const mockEscrowService = {
  fund: jest.fn(),
  findLockedByMaintenancePool: jest.fn(),
  releasePartialFromPool: jest.fn(),
};

describe('MaintenancePoolService', () => {
  let service: MaintenancePoolService;
  let poolRepo: Repository<MaintenancePool>;
  let escrowService: EscrowService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenancePoolService,
        { provide: getRepositoryToken(MaintenancePool), useValue: mockPoolRepo },
        { provide: EscrowService, useValue: mockEscrowService },
      ],
    }).compile();

    service = module.get<MaintenancePoolService>(MaintenancePoolService);
    poolRepo = module.get<Repository<MaintenancePool>>(getRepositoryToken(MaintenancePool));
    escrowService = module.get<EscrowService>(EscrowService);
    jest.clearAllMocks();
  });

  describe('deposit', () => {
    it('should create first escrow and update pool balance', async () => {
      const pool = { id: 'pool-1', asset: 'USDC', balance: '0', monthlyDeposit: '0', status: MaintenancePoolStatus.ACTIVE, escrows: [] };
      const escrow = { id: 'escrow-1', amount: '100.0000000' };
      mockPoolRepo.findOne.mockResolvedValue(pool);
      mockEscrowService.fund.mockResolvedValue(escrow);
      mockPoolRepo.save.mockImplementation((p) => Promise.resolve(p));

      const result = await service.deposit('pool-1', '100.0000000', 'funder-address');

      expect(mockEscrowService.fund).toHaveBeenCalledWith({
        amount: '100.0000000',
        asset: 'USDC',
        funderAddress: 'funder-address',
        maintenancePoolId: 'pool-1',
      });
      expect(result.balance).toBe('100.0000000');
      expect(result.escrowId).toBe('escrow-1');
    });

    it('should create second escrow and update pool balance (not orphan)', async () => {
      const pool = { id: 'pool-1', asset: 'USDC', balance: '100.0000000', monthlyDeposit: '100.0000000', status: MaintenancePoolStatus.ACTIVE, escrows: [], escrowId: 'escrow-1' };
      const escrow = { id: 'escrow-2', amount: '100.0000000' };
      mockPoolRepo.findOne.mockResolvedValue(pool);
      mockEscrowService.fund.mockResolvedValue(escrow);
      mockPoolRepo.save.mockImplementation((p) => Promise.resolve(p));

      const result = await service.deposit('pool-1', '100.0000000', 'funder-address');

      expect(mockEscrowService.fund).toHaveBeenCalledWith({
        amount: '100.0000000',
        asset: 'USDC',
        funderAddress: 'funder-address',
        maintenancePoolId: 'pool-1',
      });
      expect(result.balance).toBe('200.0000000');
      expect(result.escrowId).toBe('escrow-2');
    });
  });

  describe('assignReward', () => {
    it('should release from multiple escrows when amount exceeds first escrow', async () => {
      const pool = {
        id: 'pool-1',
        asset: 'USDC',
        balance: '200.0000000',
        monthlyDeposit: '100.0000000',
        status: MaintenancePoolStatus.ACTIVE,
        escrows: [
          { id: 'escrow-1', amount: '100.0000000', releasedAmount: '0', status: EscrowStatus.LOCKED },
          { id: 'escrow-2', amount: '100.0000000', releasedAmount: '0', status: EscrowStatus.LOCKED },
        ],
        escrowId: 'escrow-2',
      };
      const payments = [
        { id: 'payment-1', escrowId: 'escrow-1', amount: '100.0000000' },
        { id: 'payment-2', escrowId: 'escrow-2', amount: '50.0000000' },
      ];
      mockPoolRepo.findOne.mockResolvedValue(pool);
      mockEscrowService.releasePartialFromPool.mockResolvedValue(payments);
      mockPoolRepo.save.mockImplementation((p) => Promise.resolve(p));

      const result = await service.assignReward('pool-1', '150.0000000', 'recipient-address');

      expect(mockEscrowService.releasePartialFromPool).toHaveBeenCalledWith('pool-1', '150.0000000', 'recipient-address', undefined);
      expect(result.pool.balance).toBe('50.0000000');
      expect(result.payments).toHaveLength(2);
    });

    it('should throw when reward exceeds pool balance', async () => {
      const pool = { id: 'pool-1', balance: '100.0000000', escrows: [{ id: 'escrow-1' }] };
      mockPoolRepo.findOne.mockResolvedValue(pool);

      await expect(service.assignReward('pool-1', '200.0000000', 'recipient-address')).rejects.toThrow(BadRequestException);
    });

    it('should throw when pool has no escrows', async () => {
      const pool = { id: 'pool-1', balance: '0', escrows: [] };
      mockPoolRepo.findOne.mockResolvedValue(pool);

      await expect(service.assignReward('pool-1', '10.0000000', 'recipient-address')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTotalReleasableBalance', () => {
    it('should return sum of available amounts across all locked escrows', async () => {
      const escrows = [
        { amount: '100.0000000', releasedAmount: '20.0000000', status: EscrowStatus.LOCKED },
        { amount: '100.0000000', releasedAmount: '0', status: EscrowStatus.LOCKED },
        { amount: '50.0000000', releasedAmount: '50.0000000', status: EscrowStatus.RELEASED }, // should not count
      ];
      mockEscrowService.findLockedByMaintenancePool.mockResolvedValue(escrows);

      const result = await service.getTotalReleasableBalance('pool-1');

      expect(result).toBe('180.0000000');
    });
  });
});
