import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { SorobanClientService } from './soroban-client.service';
import { UsersService } from '../users/users.service';
import { Escrow, Payment } from '../common/entities';
import { AssetType, EscrowStatus } from '../common/enums';

describe('EscrowService', () => {
  let service: EscrowService;
  let escrowRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let paymentRepo: { create: jest.Mock; save: jest.Mock; find: jest.Mock };
  let soroban: { invoke: jest.Mock };
  let usersService: { findRawOrNull: jest.Mock };

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
      // releasePartial() sums prior payments to work out the remaining balance.
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
    // Backs the recipientId/recipientAddress cross-check (#40). Defaults to
    // "no such user", so any test that passes a recipientId has to say what
    // that user's address is on purpose.
    usersService = { findRawOrNull: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: getRepositoryToken(Escrow), useValue: escrowRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: SorobanClientService, useValue: soroban },
        { provide: UsersService, useValue: usersService },
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
      usersService.findRawOrNull.mockResolvedValue({
        id: 'user-1',
        stellarAddress: 'GRECIPIENT',
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

  /**
   * #40: `recipientAddress` decides who the chain pays, `recipientId` decides
   * who the Payment row credits, and nothing tied them together — so a caller
   * could pay one address while attributing the payment to someone else.
   *
   * These exercise the check through the public release methods rather than
   * calling the private helper directly, because the property that matters is
   * that every release path actually routes through it before invoking Soroban.
   * A test of the helper alone would still pass if the call site were deleted.
   */
  describe('recipientId/recipientAddress cross-check (#40)', () => {
    // A factory, not a shared constant: release() mutates the escrow it is
    // handed, so a shared object would leak RELEASED into the next test.
    const lockedEscrow = () => ({
      id: 'escrow-40',
      status: EscrowStatus.LOCKED,
      amount: '100',
      asset: AssetType.USDC,
      bountyId: 'bounty-40',
    });

    beforeEach(() => {
      escrowRepo.findOne.mockImplementation(() =>
        Promise.resolve(lockedEscrow()),
      );
      usersService.findRawOrNull.mockResolvedValue({
        id: 'user-b',
        stellarAddress: 'GABCONFILE',
      });
    });

    it('release() rejects a mismatched pair before any Soroban call', async () => {
      await expect(
        service.release('escrow-40', 'GDIFFERENT', 'user-b'),
      ).rejects.toThrow(BadRequestException);

      expect(soroban.invoke).not.toHaveBeenCalled();
      expect(paymentRepo.save).not.toHaveBeenCalled();
      expect(escrowRepo.save).not.toHaveBeenCalled();
    });

    it('release() names neither address in the rejection message', async () => {
      // The message must not become an oracle for what a given user id's
      // address actually is.
      await expect(
        service.release('escrow-40', 'GDIFFERENT', 'user-b'),
      ).rejects.toThrow(
        'recipientAddress does not match the address on file for recipientId',
      );
    });

    it('release() accepts a matching pair and reaches the chain', async () => {
      const escrow = await service.release('escrow-40', 'GABCONFILE', 'user-b');

      expect(soroban.invoke).toHaveBeenCalledWith(
        'release',
        expect.arrayContaining(['GABCONFILE']),
      );
      expect(escrow.status).toBe(EscrowStatus.RELEASED);
      expect(paymentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'user-b',
          recipientAddress: 'GABCONFILE',
        }),
      );
    });

    it('release() still allows an unattributed payout (no recipientId)', async () => {
      await service.release('escrow-40', 'GANYADDRESS');

      expect(usersService.findRawOrNull).not.toHaveBeenCalled();
      expect(soroban.invoke).toHaveBeenCalled();
    });

    it('release() rejects a recipientId that names no user', async () => {
      usersService.findRawOrNull.mockResolvedValue(null);

      await expect(
        service.release('escrow-40', 'GANYADDRESS', 'ghost-user'),
      ).rejects.toThrow(BadRequestException);
      expect(soroban.invoke).not.toHaveBeenCalled();
    });

    it('release() rejects a recipient whose record has no linked address', async () => {
      // Otherwise an unlinked user's null address would match any string the
      // caller supplied.
      usersService.findRawOrNull.mockResolvedValue({
        id: 'user-b',
        stellarAddress: null,
      });

      await expect(
        service.release('escrow-40', 'GANYADDRESS', 'user-b'),
      ).rejects.toThrow(BadRequestException);
      expect(soroban.invoke).not.toHaveBeenCalled();
    });

    it('splitRelease() rejects when any one recipient in the split mismatches', async () => {
      usersService.findRawOrNull.mockImplementation((id: string) =>
        Promise.resolve(
          id === 'user-good'
            ? { id, stellarAddress: 'GGOOD' }
            : { id, stellarAddress: 'GONFILE' },
        ),
      );

      await expect(
        service.splitRelease('escrow-40', [
          {
            recipientAddress: 'GGOOD',
            recipientId: 'user-good',
            percentage: 50,
          },
          {
            recipientAddress: 'GATTACKER',
            recipientId: 'user-bad',
            percentage: 50,
          },
        ]),
      ).rejects.toThrow(BadRequestException);

      expect(soroban.invoke).not.toHaveBeenCalled();
      expect(paymentRepo.save).not.toHaveBeenCalled();
    });

    it('splitRelease() accepts a split whose every attributed pair matches', async () => {
      usersService.findRawOrNull.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          stellarAddress: id === 'user-1' ? 'GONE' : 'GTWO',
        }),
      );

      const payments = await service.splitRelease('escrow-40', [
        { recipientAddress: 'GONE', recipientId: 'user-1', percentage: 50 },
        { recipientAddress: 'GTWO', recipientId: 'user-2', percentage: 50 },
      ]);

      expect(payments).toHaveLength(2);
      expect(soroban.invoke).toHaveBeenCalled();
    });

    it('releasePartial() rejects a mismatched pair before any Soroban call', async () => {
      // Reached by the milestone-resolve and pool-assign-reward routes, which
      // accept the same pair from the client.
      await expect(
        service.releasePartial('escrow-40', '10', 'GDIFFERENT', 'user-b'),
      ).rejects.toThrow(BadRequestException);

      expect(soroban.invoke).not.toHaveBeenCalled();
    });
  });
});
