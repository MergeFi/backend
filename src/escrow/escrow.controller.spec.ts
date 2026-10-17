import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EscrowController } from './escrow.controller';
import { EscrowService } from './escrow.service';
import { FundEscrowDto } from './dto/fund-escrow.dto';
import { AssetType } from '../common/enums';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { IDEMPOTENCY_SCOPE_KEY } from '../common/idempotency/idempotent.decorator';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import type { Escrow } from '../common/entities';
import { AssetType, EscrowStatus, PaymentStatus } from '../common/enums';
import type { FundEscrowDto } from './dto/fund-escrow.dto';
import type { SplitRecipientDto } from './dto/split-release.dto';

// These tests call the REAL EscrowController methods off a compiled Nest
// module. The previous version of this file monkey-patched the route
// handlers onto the controller instance with the raw service mocks, so it
// never invoked a single controller method and asserted only that five
// object properties were non-undefined — the metadata-leak regression
// coverage it was supposed to provide had silently disappeared (#305).
describe('EscrowController', () => {
  let controller: EscrowController;

  const escrowRow = (overrides: Partial<EscrowEntity> = {}) =>
    ({
      id: 'escrow-1',
      amount: '10.0000000',
      asset: AssetType.USDC,
      status: EscrowStatus.LOCKED,
      fundedByAddress: 'GFUNDER',
      onChainId: '4242',
      contractId: 'CESCROW',
      // metadata intentionally carries raw Soroban diagnostics and must
      // never reach an HTTP client (#19).
      metadata: { fund: { internalRpcDetail: 'soroban host stack trace' } },
      ...overrides,
    }) as unknown as Escrow;

  const fundDto = (): FundEscrowDto => ({
    amount: '10.0000000',
    asset: AssetType.USDC,
    funderAddress: 'GFUNDER',
    bountyId: '00000000-0000-4000-8000-000000000001',
  });

  const mockEscrowService = {
    fund: jest.fn(),
    findOne: jest.fn(),
    release: jest.fn(),
    refund: jest.fn(),
    splitRelease: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockEscrowService.fund.mockResolvedValue(escrowRow({ status: EscrowStatus.LOCKED }));
    mockEscrowService.findOne.mockResolvedValue(escrowRow());
    mockEscrowService.release.mockResolvedValue(escrowRow({ status: EscrowStatus.RELEASED }));
    mockEscrowService.refund.mockResolvedValue(escrowRow({ status: EscrowStatus.REFUNDED }));
    mockEscrowService.splitRelease.mockResolvedValue([
      { id: 'payment-1', amount: '10.0000000', status: PaymentStatus.CONFIRMED },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EscrowController],
      providers: [
        {
          provide: EscrowService,
          useValue: mockEscrowService,
        },
        IdempotencyInterceptor,
        Reflector,
        {
          provide: getRepositoryToken(IdempotencyKey),
          useValue: {
            findOneBy: jest.fn(),
            insert: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<EscrowController>(EscrowController);
  });

  describe('metadata stripping (#19, #305)', () => {
    it('fund() returns the service escrow without metadata', async () => {
      const dto = fundDto();
      const result = await controller.fund(dto);

      expect(mockEscrowService.fund).toHaveBeenCalledWith(dto);
      expect(result).not.toHaveProperty('metadata');
      expect(JSON.stringify(result)).not.toContain('internalRpcDetail');
    });

    it('findOne() returns the service escrow without metadata', async () => {
      const result = await controller.findOne('escrow-1');

      expect(mockEscrowService.findOne).toHaveBeenCalledWith('escrow-1');
      expect(result).not.toHaveProperty('metadata');
      expect(JSON.stringify(result)).not.toContain('internalRpcDetail');
    });

    it('release() returns the service escrow without metadata', async () => {
      const result = await controller.release('escrow-1', 'GRECIPIENT', 'user-1');

      expect(mockEscrowService.release).toHaveBeenCalledWith(
        'escrow-1',
        'GRECIPIENT',
        'user-1',
      );
      expect(result).not.toHaveProperty('metadata');
      expect(JSON.stringify(result)).not.toContain('internalRpcDetail');
    });

    it('refund() returns the service escrow without metadata', async () => {
      const result = await controller.refund('escrow-1');

      expect(mockEscrowService.refund).toHaveBeenCalledWith('escrow-1');
      expect(result).not.toHaveProperty('metadata');
      expect(JSON.stringify(result)).not.toContain('internalRpcDetail');
    });
  });

  describe('service delegation', () => {
    it('splitRelease() forwards the validated recipients and returns payments', async () => {
      const recipients: SplitRecipientDto[] = [
        { recipientAddress: 'GA', percentage: 50 },
        { recipientAddress: 'GB', percentage: 50 },
      ];

      const result = await controller.splitRelease('escrow-1', recipients);

      expect(mockEscrowService.splitRelease).toHaveBeenCalledWith(
        'escrow-1',
        recipients,
      );
      expect(result).toHaveLength(1);
    });

    it('propagates service errors instead of swallowing them', async () => {
      mockEscrowService.fund.mockRejectedValueOnce(
        new Error('contract call failed'),
      );

      await expect(controller.fund(fundDto())).rejects.toThrow(
        'contract call failed',
      );
    });
  });

  describe('mutation route guard + idempotency wiring (#305)', () => {
    const handlerFor = (name: string) =>
      (
        EscrowController.prototype as unknown as Record<
          string,
          (...args: unknown[]) => unknown
        >
      )[name];

    // @nestjs/throttler v6 stores `@Throttle({ short: {...} })` as
    // `THROTTLER_LIMIT + trackerName` / `THROTTLER_TTL + trackerName`
    // metadata on the handler (the constants are module-internal, so the
    // documented key strings are used here).
    const throttleKeys = (tracker: string) => ({
      limit: `THROTTLER:LIMIT${tracker}`,
      ttl: `THROTTLER:TTL${tracker}`,
    });

    it('release() is protected by JwtAuthGuard, RolesGuard and a 1 req/sec throttle', () => {
      const handler = handlerFor('release');
      const guards = Reflect.getMetadata('__guards__', handler) as
        | unknown[]
        | undefined;
      const { limit, ttl } = throttleKeys('short');

      expect(guards ?? []).toEqual(
        expect.arrayContaining([JwtAuthGuard, RolesGuard]),
      );
      expect(Reflect.getMetadata(limit, handler)).toBe(1);
      expect(Reflect.getMetadata(ttl, handler)).toBe(1000);
    });

    it('refund() is protected by JwtAuthGuard, RolesGuard and a 1 req/sec throttle', () => {
      const handler = handlerFor('refund');
      const guards = Reflect.getMetadata('__guards__', handler) as
        | unknown[]
        | undefined;
      const { limit, ttl } = throttleKeys('short');

      expect(guards ?? []).toEqual(
        expect.arrayContaining([JwtAuthGuard, RolesGuard]),
      );
      expect(Reflect.getMetadata(limit, handler)).toBe(1);
      expect(Reflect.getMetadata(ttl, handler)).toBe(1000);
    });

    it('release() is restricted to MAINTAINER and refund() to MAINTAINER/SPONSOR', () => {
      expect(Reflect.getMetadata(ROLES_KEY, handlerFor('release'))).toEqual([
        'MAINTAINER',
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, handlerFor('refund'))).toEqual([
        'MAINTAINER',
        'SPONSOR',
      ]);
    });

    it.each(['fund', 'release', 'refund', 'splitRelease'])(
      '%s declares an idempotency scope',
      (name) => {
        expect(
          Reflect.getMetadata(IDEMPOTENCY_SCOPE_KEY, handlerFor(name)),
        ).toBeDefined();
      },
    );
  });

  // #304: the public fund endpoint must be able to carry the same escrow
  // identity fields the internal BountiesService flow supplies, otherwise a
  // direct caller always gets a derived on-chain key and no sponsor.
  describe('FundEscrowDto validation', () => {
    const base = {
      amount: '100.0000000',
      asset: AssetType.USDC,
      funderAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567abcdefghijklmn',
      bountyId: '00000000-0000-0000-0000-000000000001',
    };

    it('accepts onChainIssueId, sponsorId and deadline', async () => {
      const dto = plainToInstance(FundEscrowDto, {
        ...base,
        onChainIssueId: '4242',
        sponsorId: '00000000-0000-0000-0000-000000000002',
        deadline: '2026-12-31T00:00:00.000Z',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('transforms an ISO deadline into a Date for EscrowService.fund', () => {
      const dto = plainToInstance(FundEscrowDto, {
        ...base,
        deadline: '2026-12-31T00:00:00.000Z',
      });
      expect(dto.deadline).toBeInstanceOf(Date);
    });

    it('rejects a non-numeric onChainIssueId', async () => {
      const dto = plainToInstance(FundEscrowDto, {
        ...base,
        onChainIssueId: 'bounty-uuid-seed',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'onChainIssueId')).toBe(true);
    });

    it('rejects a non-UUID sponsorId', async () => {
      const dto = plainToInstance(FundEscrowDto, {
        ...base,
        sponsorId: 'sponsor-1',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'sponsorId')).toBe(true);
    });

    it('rejects a non-ISO deadline', async () => {
      const dto = plainToInstance(FundEscrowDto, {
        ...base,
        deadline: 'next tuesday',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'deadline')).toBe(true);
    });

    it('still validates the pre-existing fields', async () => {
      const dto = plainToInstance(FundEscrowDto, {
        amount: 'not-money',
        asset: AssetType.USDC,
        funderAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567abcdefghijklmn',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('passes the identity fields through to the service', async () => {
      const dto = plainToInstance(FundEscrowDto, {
        ...base,
        onChainIssueId: '4242',
        sponsorId: '00000000-0000-0000-0000-000000000002',
        deadline: '2026-12-31T00:00:00.000Z',
      });
      mockEscrowService.fund.mockResolvedValueOnce({ id: 'escrow-1' });
      await controller.fund(dto);
      expect(mockEscrowService.fund).toHaveBeenCalledWith(
        expect.objectContaining({
          onChainIssueId: '4242',
          sponsorId: '00000000-0000-0000-0000-000000000002',
          deadline: new Date('2026-12-31T00:00:00.000Z'),
        }),
      );
    });
  });
  it('shapes splitRelease response using toPublicPayment (#368)', async () => {
    mockEscrowService.splitRelease.mockResolvedValue([
      {
        id: 'p1',
        escrowId: 'e1',
        recipientAddress: 'GADDR1',
        amount: '50.00',
        escrow: { secret: 'internal' },
        recipient: { email: 'hidden@mergifi.io' },
      },
    ]);

    const result = await controller.splitRelease('00000000-0000-0000-0000-000000000001', {
      recipients: [{ recipientAddress: 'GADDR1', percentage: 100 }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('escrow');
    expect(result[0]).not.toHaveProperty('recipient');
    expect(result[0].id).toBe('p1');
    expect(result[0].amount).toBe('50.00');
  });
});
