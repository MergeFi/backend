import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { SorobanClientService } from './soroban-client.service';
import { Escrow, Payment } from '../common/entities';
import { AssetType, EscrowStatus, PaymentStatus } from '../common/enums';

describe('EscrowService', () => {
  let service: EscrowService;
  let escrowRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let paymentRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
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
      find: jest.fn().mockResolvedValue([]),
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

  describe('releasePartial', () => {
    const lockedEscrow = () => ({
      id: 'escrow-partial',
      status: EscrowStatus.LOCKED,
      amount: '100.0000000',
      asset: AssetType.USDC,
      milestoneId: 'milestone-1',
    });

    it('releases part of a LOCKED escrow and records a Payment while it stays LOCKED below the total', async () => {
      const escrow = lockedEscrow();
      escrowRepo.findOne.mockResolvedValue(escrow);
      paymentRepo.find.mockResolvedValue([]);

      const payment = await service.releasePartial(
        'escrow-partial',
        '30.0000000',
        'GRECIPIENT',
        'user-1',
      );

      expect(soroban.invoke).toHaveBeenCalledWith('release', [
        'milestone-1',
        'GRECIPIENT',
        300_000_000n,
      ]);
      expect(paymentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          escrowId: 'escrow-partial',
          recipientId: 'user-1',
          recipientAddress: 'GRECIPIENT',
          amount: '30.0000000',
          asset: AssetType.USDC,
          status: PaymentStatus.CONFIRMED,
        }),
      );
      expect(payment.amount).toBe('30.0000000');
      expect(escrow.status).toBe(EscrowStatus.LOCKED);
      expect(escrowRepo.save).not.toHaveBeenCalled();
    });

    it('flips the escrow to RELEASED when a single partial release covers the full amount', async () => {
      escrowRepo.findOne.mockResolvedValue(lockedEscrow());
      paymentRepo.find.mockResolvedValue([]);

      await service.releasePartial(
        'escrow-partial',
        '100.0000000',
        'GRECIPIENT',
      );

      expect(escrowRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'escrow-partial',
          status: EscrowStatus.RELEASED,
          releaseTxHash: 'tx-hash-123',
        }),
      );
    });

    it('completes a partial-then-partial sequence only once the cumulative total reaches the amount', async () => {
      escrowRepo.findOne.mockResolvedValue(lockedEscrow());
      paymentRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ amount: '40.0000000' }]);

      await service.releasePartial('escrow-partial', '40.0000000', 'GA');
      expect(escrowRepo.save).not.toHaveBeenCalled();

      await service.releasePartial('escrow-partial', '60.0000000', 'GB');

      expect(soroban.invoke).toHaveBeenNthCalledWith(2, 'release', [
        'milestone-1',
        'GB',
        600_000_000n,
      ]);
      expect(escrowRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: EscrowStatus.RELEASED,
          releasedAt: expect.any(Date),
        }),
      );
    });

    it('rejects a release that would exceed the remaining balance after prior partials', async () => {
      escrowRepo.findOne.mockResolvedValue(lockedEscrow());
      paymentRepo.find.mockResolvedValue([{ amount: '50.0000000' }]);

      await expect(
        service.releasePartial('escrow-partial', '60.0000000', 'GRECIPIENT'),
      ).rejects.toThrow(BadRequestException);

      expect(soroban.invoke).not.toHaveBeenCalled();
      expect(paymentRepo.save).not.toHaveBeenCalled();
      expect(escrowRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('refund', () => {
    it('rejects refunding an escrow that is not LOCKED', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-pending',
        status: EscrowStatus.PENDING,
        amount: '10',
        asset: AssetType.USDC,
      });

      await expect(service.refund('escrow-pending')).rejects.toThrow(
        BadRequestException,
      );
      expect(soroban.invoke).not.toHaveBeenCalled();
    });

    it('refunds a LOCKED escrow to the original funder', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-refund',
        status: EscrowStatus.LOCKED,
        amount: '25.0000000',
        asset: AssetType.USDC,
        bountyId: 'bounty-7',
      });

      const escrow = await service.refund('escrow-refund');

      expect(soroban.invoke).toHaveBeenCalledWith('refund', ['bounty-7']);
      expect(escrow.status).toBe(EscrowStatus.REFUNDED);
      expect(escrow.refundTxHash).toBe('tx-hash-123');
      expect(escrow.refundedAt).toBeInstanceOf(Date);
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

    it('records split amounts that sum to exactly escrow.amount in stroops (#43)', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-uneven',
        status: EscrowStatus.LOCKED,
        amount: '100.0000000',
        asset: AssetType.USDC,
        bountyId: 'bounty-uneven',
      });

      const payments = await service.splitRelease('escrow-uneven', [
        { recipientAddress: 'GA', percentage: 33.33 },
        { recipientAddress: 'GB', percentage: 33.33 },
        { recipientAddress: 'GC', percentage: 33.34 },
      ]);

      const totalStroops = payments.reduce(
        (sum, p) => sum + BigInt(Math.round(Number(p.amount) * 1e7)),
        0n,
      );
      expect(totalStroops).toBe(1_000_000_000n);
    });

    it('sends basis points on-chain that sum to exactly 10,000', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-bps',
        status: EscrowStatus.LOCKED,
        amount: '100.0000000',
        asset: AssetType.USDC,
        bountyId: 'bounty-bps',
      });

      await service.splitRelease('escrow-bps', [
        { recipientAddress: 'GA', percentage: 33.333 },
        { recipientAddress: 'GB', percentage: 33.333 },
        { recipientAddress: 'GC', percentage: 33.334 },
      ]);

      const invokeCall = soroban.invoke.mock.calls[0] as unknown[];
      const splitArgs = invokeCall[1] as unknown[];
      const bps = splitArgs[2] as number[];
      expect(bps.reduce((a, b) => a + b, 0)).toBe(10_000);
    });
  });
});
