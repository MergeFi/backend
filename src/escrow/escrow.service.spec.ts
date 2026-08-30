import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EscrowService } from './escrow.service';
import { SorobanClientService } from './soroban-client.service';
import { Escrow, Payment, User } from '../common/entities';
import { AssetType, EscrowStatus, PaymentStatus } from '../common/enums';

describe('EscrowService', () => {
  let service: EscrowService;
  let escrowRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
-
  let paymentRepo: { create: jest.Mock; save: jest.Mock; find: jest.Mock };

  let userRepo: { find: jest.Mock };
  let paymentRepo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let soroban: {
    invoke: jest.Mock;
    escrowContractId: string;
    maintenancePoolContractId: string;
    tokenContractId: jest.Mock;
    escrowDeadlineSeconds: number;
  };

  let soroban: { invoke: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    escrowRepo = {
      create: jest.fn((data: Partial<Escrow>) => ({ id: 'escrow-1', ...data })),
      save: jest.fn((data: Partial<Escrow>) => Promise.resolve(data)),
      findOne: jest.fn(),
    };
    paymentRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: Partial<Payment>) => ({
        id: 'payment-1',
        ...data,
      })),
      save: jest.fn((data: Partial<Payment>) => Promise.resolve(data)),
      find: jest.fn().mockResolvedValue([]),
    };
    userRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 'user-1', stellarAddress: 'GRECIPIENT' }]),
    };
    soroban = {
      invoke: jest.fn().mockResolvedValue({
        txHash: 'tx-hash-123',
        ledger: 42,
        returnValue: null,
        status: 'SUCCESS',
      }),
      // Dry-run defaults: no contract configured, so EscrowService persists a
      // null contractId and passes an empty options object to invoke().
      escrowContractId: '',
      maintenancePoolContractId: '',
      tokenContractId: jest.fn().mockReturnValue(''),
      escrowDeadlineSeconds: 7776000,
    };
    // The transaction manager routes save(Entity, data) to the matching repo
    // mock so existing escrowRepo.save / paymentRepo.save assertions still hold.
    const manager = {
      save: jest.fn((entity: unknown, data: unknown) =>
        entity === Payment ? paymentRepo.save(data) : escrowRepo.save(data),
      ),
    };
    dataSource = {
      transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: getRepositoryToken(Escrow), useValue: escrowRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: DataSource, useValue: dataSource },
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
        onChainIssueId: '4242',
      });

      // escrow::fund(issue_id, sponsor, token, amount, deadline) (#158)
      const [method, args] = soroban.invoke.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(method).toBe('fund');
      expect(args[0]).toBe(4242n);
      expect(args[1]).toBe('GABC...FUNDER');
      expect(args[3]).toBe(1_000_000_000n);
      expect(typeof args[4]).toBe('bigint');
      expect(escrow.status).toBe(EscrowStatus.LOCKED);
      expect(escrow.fundTxHash).toBe('tx-hash-123');
    });

    it('sends the token address and a deadline, and persists them on the row (#158)', async () => {
      soroban.tokenContractId.mockReturnValue('CUSDCTOKEN');

      const deadline = new Date('2026-12-31T00:00:00.000Z');
      const escrow = await service.fund({
        amount: '10.0000000',
        asset: AssetType.USDC,
        funderAddress: 'GFUNDER',
        bountyId: 'bounty-1',
        onChainIssueId: '77',
        deadline,
      });

      const [, args] = soroban.invoke.mock.calls[0] as [string, unknown[]];
      expect(args[2]).toBe('CUSDCTOKEN');
      expect(args[4]).toBe(BigInt(Math.floor(deadline.getTime() / 1000)));
      expect(escrow.onChainId).toBe('77');
      expect(escrow.deadline).toBe(deadline);
    });

    it('derives a stable numeric on-chain id when the caller supplies none', async () => {
      const first = await service.fund({
        amount: '1.0000000',
        asset: AssetType.USDC,
        funderAddress: 'GFUNDER',
        milestoneId: 'milestone-1',
      });
      const second = await service.fund({
        amount: '1.0000000',
        asset: AssetType.USDC,
        funderAddress: 'GFUNDER',
        milestoneId: 'milestone-1',
      });

      expect(first.onChainId).toMatch(/^\d+$/);
      expect(first.onChainId).toBe(second.onChainId);
      expect(() => BigInt(first.onChainId as string)).not.toThrow();
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
      // Distinct from releasePartial's 'release_partial' method name (#159).
      expect(soroban.invoke).toHaveBeenCalledWith('release', [
        'bounty-3',
        'GRECIPIENT',
      ]);
      expect(paymentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientAddress: 'GRECIPIENT',
          amount: '50',
        }),
      );
    });

    it('writes the escrow status and the Payment in one transaction (#154)', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-3',
        status: EscrowStatus.LOCKED,
        amount: '50',
        asset: AssetType.USDC,
        bountyId: 'bounty-3',
      });

      await service.release('escrow-3', 'GRECIPIENT', 'user-1');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a recipientId with no matching user before invoking Soroban (#154)', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-3',
        status: EscrowStatus.LOCKED,
        amount: '50',
        asset: AssetType.USDC,
        bountyId: 'bounty-3',
      });
      userRepo.find.mockResolvedValue([]);

      await expect(
        service.release('escrow-3', 'GRECIPIENT', 'ghost-user'),
      ).rejects.toThrow(BadRequestException);
      expect(soroban.invoke).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('propagates a Payment-insert failure out of the transaction (#154)', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-3',
        status: EscrowStatus.LOCKED,
        amount: '50',
        asset: AssetType.USDC,
        bountyId: 'bounty-3',
      });
      paymentRepo.save.mockRejectedValueOnce(new Error('FK violation'));

      await expect(
        service.release('escrow-3', 'GRECIPIENT', 'user-1'),
      ).rejects.toThrow('FK violation');
    });
  });

  describe('releasePartial', () => {
    const lockedEscrow = () => ({
      id: 'escrow-partial',
      status: EscrowStatus.LOCKED,
      amount: '100.0000000',
      asset: AssetType.USDC,
      milestoneId: 'milestone-1',
      onChainId: '9100',
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

      expect(soroban.invoke).toHaveBeenCalledWith(
        'release',
        [9100n, 'GRECIPIENT', 300_000_000n],
        {},
      );
      expect(soroban.invoke).toHaveBeenCalledWith('release_partial', [
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

      expect(soroban.invoke).toHaveBeenNthCalledWith(
        2,
        'release',
        [9100n, 'GB', 600_000_000n],
        {},
      );
      expect(soroban.invoke).toHaveBeenNthCalledWith(2, 'release_partial', [
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
        onChainId: '7007',
      });

      const escrow = await service.refund('escrow-refund');

      expect(soroban.invoke).toHaveBeenCalledWith('refund', [7007n], {});
      expect(escrow.status).toBe(EscrowStatus.REFUNDED);
      expect(escrow.refundTxHash).toBe('tx-hash-123');
      expect(escrow.refundedAt).toBeInstanceOf(Date);
    });
  });

  describe('contract targeting (#157)', () => {
    it('persists the escrow contract id on a bounty escrow and targets it on fund', async () => {
      soroban.escrowContractId = 'CESCROW';
      soroban.maintenancePoolContractId = 'CESCROW';

      const escrow = await service.fund({
        amount: '100.0000000',
        asset: AssetType.USDC,
        funderAddress: 'GFUNDER',
        bountyId: 'bounty-1',
      });

      expect(escrow.contractId).toBe('CESCROW');
      expect(soroban.invoke).toHaveBeenCalledWith('fund', expect.any(Array), {
        contractId: 'CESCROW',
      });
    });

    it('targets the maintenance-pool contract for a pool escrow', async () => {
      soroban.escrowContractId = 'CESCROW';
      soroban.maintenancePoolContractId = 'CPOOL';

      const escrow = await service.fund({
        amount: '100.0000000',
        asset: AssetType.USDC,
        funderAddress: 'GFUNDER',
        maintenancePoolId: 'pool-1',
      });

      expect(escrow.contractId).toBe('CPOOL');
      expect(soroban.invoke).toHaveBeenCalledWith('fund', expect.any(Array), {
        contractId: 'CPOOL',
      });
    });

    it('reuses the escrow row contract id on a later release', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-pinned',
        status: EscrowStatus.LOCKED,
        amount: '10',
        asset: AssetType.USDC,
        bountyId: 'bounty-9',
        contractId: 'CPINNED',
      });

      await service.release('escrow-pinned', 'GRECIPIENT', 'user-1');

      expect(soroban.invoke).toHaveBeenCalledWith(
        'release',
        expect.any(Array),
        { contractId: 'CPINNED' },
      );
    });
  });

  it('rejects a full release after a partial release on the same still-LOCKED escrow', async () => {
    const escrow = {
      id: 'escrow-partial-then-full',
      status: EscrowStatus.LOCKED,
      amount: '100',
      asset: AssetType.USDC,
      milestoneId: 'milestone-1',
    } as Escrow;
    const payments: Partial<Payment>[] = [];
    escrowRepo.findOne.mockResolvedValue(escrow);
    paymentRepo.find.mockImplementation(() => Promise.resolve(payments));
    paymentRepo.save.mockImplementation((payment: Partial<Payment>) => {
      payments.push(payment);
      return payment;
    });

    await service.releasePartial(
      'escrow-partial-then-full',
      '50',
      'GRECIPIENT',
    );
    expect(escrow.status).toBe(EscrowStatus.LOCKED);

    await expect(
      service.release('escrow-partial-then-full', 'GATTACKER'),
    ).rejects.toThrow(BadRequestException);
    expect(soroban.invoke).toHaveBeenCalledTimes(1);
    expect(soroban.invoke).toHaveBeenCalledWith('release', [
      'milestone-1',
      'GRECIPIENT',
      500000000n,
    ]);
  });

  it('rejects splitRelease when an escrow has prior payment history', async () => {
    escrowRepo.findOne.mockResolvedValue({
      id: 'escrow-split-after-partial',
      status: EscrowStatus.LOCKED,
      amount: '100',
      asset: AssetType.USDC,
      milestoneId: 'milestone-2',
    });
    paymentRepo.find.mockResolvedValue([{ amount: '25' }]);

    await expect(
      service.splitRelease('escrow-split-after-partial', [
        { recipientAddress: 'GA', percentage: 100 },
      ]),
    ).rejects.toThrow(BadRequestException);
    expect(soroban.invoke).not.toHaveBeenCalled();
  });

  it('rejects releasePartial after a full release is recorded', async () => {
    escrowRepo.findOne.mockResolvedValue({
      id: 'escrow-full',
      status: EscrowStatus.RELEASED,
      amount: '100',
      asset: AssetType.USDC,
      bountyId: 'bounty-full',
    });
    paymentRepo.find.mockResolvedValue([{ amount: '100' }]);

    await expect(
      service.releasePartial('escrow-full', '1', 'GRECIPIENT'),
    ).rejects.toThrow(BadRequestException);
    expect(soroban.invoke).not.toHaveBeenCalled();
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

    it('calls the contract release entrypoint with (issue_id, Vec<(Address, u32)>) whose bps sum to 10,000 (#161)', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-bps',
        status: EscrowStatus.LOCKED,
        amount: '100.0000000',
        asset: AssetType.USDC,
        bountyId: 'bounty-bps',
        onChainId: '8801',
      });

      await service.splitRelease('escrow-bps', [
        { recipientAddress: 'GA', percentage: 33.333 },
        { recipientAddress: 'GB', percentage: 33.333 },
        { recipientAddress: 'GC', percentage: 33.334 },
      ]);

      const [method, args] = soroban.invoke.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(method).toBe('release');
      expect(args[0]).toBe(8801n);
      const recipients = args[1] as Array<[string, number]>;
      expect(recipients.map((r) => r[0])).toEqual(['GA', 'GB', 'GC']);
      expect(recipients.reduce((sum, r) => sum + r[1], 0)).toBe(10_000);
    });

    it('never invokes a split_release method (#161)', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-4',
        status: EscrowStatus.LOCKED,
        amount: '100',
        asset: AssetType.USDC,
        bountyId: 'bounty-4',
        onChainId: '4004',
      });

      await service.splitRelease('escrow-4', [
        { recipientAddress: 'GA', percentage: 50 },
        { recipientAddress: 'GB', percentage: 50 },
      ]);

      const methods = soroban.invoke.mock.calls.map((c) => c[0]);
      expect(methods).not.toContain('split_release');
    });
  });

  describe('release convergence (#161)', () => {
    it('releases a single recipient as the degenerate [(addr, 10000)] split', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-solo',
        status: EscrowStatus.LOCKED,
        amount: '50',
        asset: AssetType.USDC,
        bountyId: 'bounty-3',
        onChainId: '3003',
      });

      await service.release('escrow-solo', 'GRECIPIENT', 'user-1');

      expect(soroban.invoke).toHaveBeenCalledWith(
        'release',
        [3003n, [['GRECIPIENT', 10_000]]],
        {},
      );
    });

    it('writes the escrow status and every recipient Payment in one transaction (#154)', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-4',
        status: EscrowStatus.LOCKED,
        amount: '100',
        asset: AssetType.USDC,
        bountyId: 'bounty-4',
      });

      await service.splitRelease('escrow-4', [
        { recipientAddress: 'GA', percentage: 50 },
        { recipientAddress: 'GB', percentage: 50 },
      ]);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('propagates a mid-loop Payment failure out of the split transaction (#154)', async () => {
      escrowRepo.findOne.mockResolvedValue({
        id: 'escrow-4',
        status: EscrowStatus.LOCKED,
        amount: '100',
        asset: AssetType.USDC,
        bountyId: 'bounty-4',
      });
      paymentRepo.save
        .mockResolvedValueOnce({ id: 'payment-1' })
        .mockRejectedValueOnce(new Error('FK violation on recipient 2'));

      await expect(
        service.splitRelease('escrow-4', [
          { recipientAddress: 'GA', percentage: 50 },
          { recipientAddress: 'GB', percentage: 50 },
        ]),
      ).rejects.toThrow('FK violation on recipient 2');
    });
  });
});
