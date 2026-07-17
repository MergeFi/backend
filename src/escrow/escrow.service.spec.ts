import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { SorobanClientService } from './soroban-client.service';
import { Escrow, Payment } from '../common/entities';
import { AssetType, EscrowStatus } from '../common/enums';

describe('EscrowService', () => {
  let service: EscrowService;
  let escrowRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let paymentRepo: { create: jest.Mock; save: jest.Mock };
  let soroban: { invoke: jest.Mock };

  beforeEach(async () => {
    escrowRepo = {
      create: jest.fn((data: Partial<Escrow>) => ({ id: 'escrow-1', ...data })),
      save: jest.fn((data: Partial<Escrow>) => Promise.resolve(data)),
      findOne: jest.fn(),
    };
    paymentRepo = {
      create: jest.fn((data: Partial<Payment>) => ({
        id: 'payment-1',
        ...data,
      })),
      save: jest.fn((data: Partial<Payment>) => Promise.resolve(data)),
    };
    soroban = {
      invoke: jest.fn().mockResolvedValue({
        txHash: 'tx-hash-123',
        ledger: 42,
        returnValue: null,
        status: 'SUCCESS',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: getRepositoryToken(Escrow), useValue: escrowRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: SorobanClientService, useValue: soroban },
      ],
    }).compile();

    service = module.get(EscrowService);
  });

  describe('fund', () => {
    it('locks funds and marks the escrow LOCKED on success', async () => {
      const escrow = await service.fund({
        amount: '100.0000000',
        asset: AssetType.USDC,
        funderAddress: 'GABC...FUNDER',
        bountyId: 'bounty-1',
      });

      expect(soroban.invoke).toHaveBeenCalledWith(
        'fund',
        expect.arrayContaining(['GABC...FUNDER', 'bounty-1']),
      );
      expect(escrow.status).toBe(EscrowStatus.LOCKED);
      expect(escrow.fundTxHash).toBe('tx-hash-123');
    });

    it('persists the denormalized sponsorId on the created escrow row', async () => {
      const escrow = await service.fund({
        amount: '100.0000000',
        asset: AssetType.USDC,
        funderAddress: 'GABC...FUNDER',
        bountyId: 'bounty-1',
        sponsorId: 'sponsor-1',
      });

      expect(escrowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sponsorId: 'sponsor-1' }),
      );
      expect(escrow.sponsorId).toBe('sponsor-1');
    });

    it('defaults sponsorId to null when omitted (e.g. maintenance-pool escrows)', async () => {
      await service.fund({
        amount: '100.0000000',
        asset: AssetType.USDC,
        funderAddress: 'GABC...FUNDER',
        maintenancePoolId: 'pool-1',
      });

      expect(escrowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sponsorId: null }),
      );
    });

    it('marks the escrow FAILED and rethrows when the contract call fails', async () => {
      soroban.invoke.mockRejectedValueOnce(new Error('simulation failed'));

      await expect(
        service.fund({
          amount: '10',
          asset: AssetType.XLM,
          funderAddress: 'G...',
          bountyId: 'bounty-1',
        }),
      ).rejects.toThrow('simulation failed');

      const savedCalls = (
        escrowRepo.save.mock.calls as [Partial<Escrow>][]
      ).map((c) => c[0]);
      expect(savedCalls.some((e) => e.status === EscrowStatus.FAILED)).toBe(
        true,
      );
    });

    it.each([
      '0',
      '-1',
      '1e3',
      '1,000',
      'not-a-number',
      '1.00000001',
      '100000000.0000001',
    ])(
      'rejects malformed amount %s before escrow creation or chain calls',
      async (amount) => {
        await expect(
          service.fund({
            amount,
            asset: AssetType.USDC,
            funderAddress: 'G...FUNDER',
          }),
        ).rejects.toThrow(BadRequestException);

        expect(escrowRepo.create).not.toHaveBeenCalled();
        expect(escrowRepo.save).not.toHaveBeenCalled();
        expect(soroban.invoke).not.toHaveBeenCalled();
      },
    );

    it('rejects unsupported assets before escrow creation or chain calls', async () => {
      await expect(
        service.fund({
          amount: '10.0000000',
          asset: 'BTC' as AssetType,
          funderAddress: 'G...FUNDER',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(escrowRepo.create).not.toHaveBeenCalled();
      expect(escrowRepo.save).not.toHaveBeenCalled();
      expect(soroban.invoke).not.toHaveBeenCalled();
    });

    it('rejects funding with no parent (bounty/milestone/pool) set at all', async () => {
      await expect(
        service.fund({
          amount: '10.0000000',
          asset: AssetType.USDC,
          funderAddress: 'G...FUNDER',
        }),
      ).rejects.toThrow(
        'Exactly one of bountyId, milestoneId, or maintenancePoolId is required',
      );

      expect(escrowRepo.create).not.toHaveBeenCalled();
      expect(soroban.invoke).not.toHaveBeenCalled();
    });

    it('rejects funding with more than one parent set', async () => {
      await expect(
        service.fund({
          amount: '10.0000000',
          asset: AssetType.USDC,
          funderAddress: 'G...FUNDER',
          bountyId: 'bounty-1',
          milestoneId: 'milestone-1',
        }),
      ).rejects.toThrow(
        'Exactly one of bountyId, milestoneId, or maintenancePoolId is required',
      );

      expect(escrowRepo.create).not.toHaveBeenCalled();
      expect(soroban.invoke).not.toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('rejects releasing an escrow that is not LOCKED', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-2',
        status: EscrowStatus.PENDING,
        amount: '10',
        asset: AssetType.USDC,
      });

      await expect(service.release('escrow-2', 'GRECIPIENT')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('releases a LOCKED escrow and records a Payment', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-3',
        status: EscrowStatus.LOCKED,
        amount: '50',
        asset: AssetType.USDC,
        bountyId: 'bounty-3',
      });

      const escrow = await service.release('escrow-3', 'GRECIPIENT', 'user-1');

      expect(escrow.status).toBe(EscrowStatus.RELEASED);
      expect(paymentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientAddress: 'GRECIPIENT',
          amount: '50',
        }),
      );
    });
  });

  describe('assertValidSplits / splitRelease', () => {
    it('throws when percentages do not sum to 100', () => {
      expect(() =>
        service.assertValidSplits([
          { recipientAddress: 'G1', percentage: 40 },
          { recipientAddress: 'G2', percentage: 40 },
        ]),
      ).toThrow(BadRequestException);
    });

    it('accepts percentages that sum to 100 within tolerance', () => {
      expect(() =>
        service.assertValidSplits([
          { recipientAddress: 'G1', percentage: 40 },
          { recipientAddress: 'G2', percentage: 40 },
          { recipientAddress: 'G3', percentage: 20 },
        ]),
      ).not.toThrow();
    });

    it('splits a released escrow proportionally across recipients', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-4',
        status: EscrowStatus.LOCKED,
        amount: '100',
        asset: AssetType.USDC,
        bountyId: 'bounty-4',
      });

      const payments = await service.splitRelease('escrow-4', [
        { recipientAddress: 'GFRONTEND', percentage: 40 },
        { recipientAddress: 'GBACKEND', percentage: 40 },
        { recipientAddress: 'GTEST', percentage: 20 },
      ]);

      expect(payments).toHaveLength(3);
      expect(payments[0].amount).toBe('40.0000000');
      expect(payments[1].amount).toBe('40.0000000');
      expect(payments[2].amount).toBe('20.0000000');
    });
  });
});
