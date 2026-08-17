import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EscrowController } from './escrow.controller';
import { EscrowService } from './escrow.service';
import { UsersService } from '../users/users.service';
import { AssetType, EscrowStatus } from '../common/enums';
import { Escrow } from '../common/entities';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

/**
 * Minimal stand-in for the request object a JwtAuthGuard-protected handler
 * receives. Only `user` is read by these handlers.
 */
const requestAs = (userId: string): AuthenticatedRequest =>
  ({ user: { userId, username: userId } }) as AuthenticatedRequest;

function makeEscrowWithLeakyMetadata(): Escrow {
  return {
    id: 'esc_1',
    bounty: null,
    bountyId: 'bounty_1',
    milestone: null,
    milestoneId: null,
    maintenancePool: null,
    maintenancePoolId: null,
    sponsorId: 'sponsor_1',
    contractId: null,
    amount: '100.0000000',
    asset: AssetType.USDC,
    status: EscrowStatus.FAILED,
    fundedByAddress: 'GFUNDER',
    fundTxHash: null,
    releaseTxHash: null,
    refundTxHash: null,
    metadata: {
      error:
        'Soroban simulation failed: internal RPC detail that must never reach a client',
    },
    payments: [],
    lockedAt: null,
    releasedAt: null,
    refundedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('EscrowController (#19 metadata leak)', () => {
  let controller: EscrowController;
  let escrowService: {
    fund: jest.Mock;
    findOne: jest.Mock;
    release: jest.Mock;
    refund: jest.Mock;
    splitRelease: jest.Mock;
  };
  let usersService: { assertOwnsStellarAddress: jest.Mock };

  beforeEach(async () => {
    usersService = {
      assertOwnsStellarAddress: jest.fn().mockResolvedValue(undefined),
    };
    escrowService = {
      fund: jest.fn().mockResolvedValue(makeEscrowWithLeakyMetadata()),
      findOne: jest.fn().mockResolvedValue(makeEscrowWithLeakyMetadata()),
      release: jest.fn().mockResolvedValue(makeEscrowWithLeakyMetadata()),
      refund: jest.fn().mockResolvedValue(makeEscrowWithLeakyMetadata()),
      splitRelease: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EscrowController],
      providers: [
        { provide: EscrowService, useValue: escrowService },
        { provide: UsersService, useValue: usersService },
        // These endpoints carry @Idempotent, which resolves
        // IdempotencyInterceptor via DI even though this suite calls
        // controller methods directly and never runs the interceptor
        // itself (#16).
        IdempotencyInterceptor,
        Reflector,
        {
          provide: getRepositoryToken(IdempotencyKey),
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get(EscrowController);
  });

  it('fund() never returns metadata to the client', async () => {
    const result = await controller.fund(
      {
        amount: '100',
        asset: AssetType.USDC,
        funderAddress: 'GFUNDER',
        bountyId: 'bounty_1',
      },
      requestAs('user_1'),
    );

    expect(result).not.toHaveProperty('metadata');
    expect(JSON.stringify(result)).not.toContain('internal RPC detail');
  });

  it('findOne() (GET /escrow/:id) never returns metadata to the client', async () => {
    const result = await controller.findOne('esc_1');

    expect(result).not.toHaveProperty('metadata');
    expect(JSON.stringify(result)).not.toContain('internal RPC detail');
  });

  it('release() never returns metadata to the client', async () => {
    const result = await controller.release('esc_1', {
      recipientAddress: 'GRECIPIENT',
    });

    expect(result).not.toHaveProperty('metadata');
  });

  it('refund() never returns metadata to the client', async () => {
    const result = await controller.refund('esc_1');

    expect(result).not.toHaveProperty('metadata');
  });

  describe('#40 funderAddress is bound to the caller', () => {
    it('checks funderAddress against the caller before funding anything', async () => {
      await controller.fund(
        {
          amount: '100',
          asset: AssetType.USDC,
          funderAddress: 'GFUNDER',
          bountyId: 'bounty_1',
        },
        requestAs('user_a'),
      );

      expect(usersService.assertOwnsStellarAddress).toHaveBeenCalledWith(
        'user_a',
        'GFUNDER',
      );
    });

    it("does not fund when the address is not the caller's own", async () => {
      usersService.assertOwnsStellarAddress.mockRejectedValue(
        new ForbiddenException(
          'funderAddress must match your linked Stellar address',
        ),
      );

      await expect(
        controller.fund(
          {
            amount: '100',
            asset: AssetType.USDC,
            funderAddress: 'GSOMEONE_ELSE',
            bountyId: 'bounty_1',
          },
          requestAs('user_a'),
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(escrowService.fund).not.toHaveBeenCalled();
    });
  });
});
