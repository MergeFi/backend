import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EscrowService } from './escrow.service';
import { Escrow } from '../common/entities/escrow.entity';
import { Payment } from '../common/entities/payment.entity';
import { EscrowStatus } from '../common/enums';
import { SplitRecipient } from './dto/split-release.dto';
import { NotFoundException, BadRequestException } from '@nestjs/common';

const mockEscrowRepo = () => ({
  findOne: jest.fn(),
  save: jest.fn(),
});

const mockPaymentRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
});

const mockSorobanClient = () => ({
  invoke: jest.fn().mockResolvedValue({ txHash: 'mock-tx-hash', returnValue: null }),
});

describe('EscrowService', () => {
  let service: EscrowService;
  let escrowRepo: jest.Mocked<Repository<Escrow>>;
  let paymentRepo: jest.Mocked<Repository<Payment>>;
  let soroban: jest.Mocked<ReturnType<typeof mockSorobanClient>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: getRepositoryToken(Escrow), useFactory: mockEscrowRepo },
        { provide: getRepositoryToken(Payment), useFactory: mockPaymentRepo },
        { provide: 'SorobanClientService', useFactory: mockSorobanClient },
      ],
    }).compile();

    service = module.get<EscrowService>(EscrowService);
    escrowRepo = module.get(getRepositoryToken(Escrow));
    paymentRepo = module.get(getRepositoryToken(Payment));
    soroban = module.get('SorobanClientService');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('splitRelease', () => {
    const mockEscrow = {
      id: 'escrow-1',
      bountyId: 'bounty-1',
      milestoneId: null,
      amount: '100.0000000',
      status: EscrowStatus.LOCKED,
      fundTxHash: 'fund-tx',
    };

    const recipients: SplitRecipient[] = [
      { recipientAddress: 'GABC1', percentage: 33.33 },
      { recipientAddress: 'GABC2', percentage: 33.33 },
      { recipientAddress: 'GABC3', percentage: 33.34 },
    ];

    beforeEach(() => {
      escrowRepo.findOne.mockResolvedValue(mockEscrow as any);
      escrowRepo.save.mockImplementation(async (e) => e);
      paymentRepo.create.mockImplementation((p) => p as any);
      paymentRepo.save.mockImplementation(async (p) => p as any);
    });

    it('should split release and record payments with exact sum matching escrow amount', async () => {
      const payments = await service.splitRelease('escrow-1', recipients);

      expect(payments).toHaveLength(3);
      expect(soroban.invoke).toHaveBeenCalledWith('split_release', [
        'bounty-1',
        ['GABC1', 'GABC2', 'GABC3'],
        [3333, 3333, 3334], // basis points: percentage * 100, rounded
      ]);

      // Verify each payment amount is recorded
      expect(payments[0].amount).toBeDefined();
      expect(payments[1].amount).toBeDefined();
      expect(payments[2].amount).toBeDefined();

      // Verify sum of payments exactly equals escrow amount using BigInt (stroops)
      const sumStroops = payments.reduce((acc, p) => acc + BigInt(Math.round(Number(p.amount) * 1e7)), 0n);
      const escrowStroops = BigInt(Math.round(Number(mockEscrow.amount) * 1e7));
      expect(sumStroops).toBe(escrowStroops);
    });

    it('should throw if escrow not found', async () => {
      escrowRepo.findOne.mockResolvedValue(null);
      await expect(service.splitRelease('missing', recipients)).rejects.toThrow(NotFoundException);
    });

    it('should throw if escrow not locked', async () => {
      escrowRepo.findOne.mockResolvedValue({ ...mockEscrow, status: EscrowStatus.PENDING } as any);
      await expect(service.splitRelease('escrow-1', recipients)).rejects.toThrow(BadRequestException);
    });

    it('should throw if percentages do not sum to 100', async () => {
      const badRecipients = [{ recipientAddress: 'GABC1', percentage: 50 }];
      await expect(service.splitRelease('escrow-1', badRecipients)).rejects.toThrow(BadRequestException);
    });

    it('should throw if any percentage is invalid', async () => {
      const badRecipients = [{ recipientAddress: 'GABC1', percentage: -10 }];
      await expect(service.splitRelease('escrow-1', badRecipients)).rejects.toThrow(BadRequestException);
    });
  });
});
