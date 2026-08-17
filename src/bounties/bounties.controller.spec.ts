import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BountiesController } from './bounties.controller';
import { BountiesService } from './bounties.service';
import { UsersService } from '../users/users.service';
import { BountyStatus } from '../common/enums';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Minimal stand-in for the request a JwtAuthGuard-protected handler receives.
 * Only `user` is read by these handlers.
 */
const requestAs = (userId: string): AuthenticatedRequest =>
  ({ user: { userId, username: userId } }) as AuthenticatedRequest;

/**
 * #40: `POST /bounties/:id/claim` used to take `contributorId` from the request
 * body, so a caller authenticated as user A could set `claimedById` to user B.
 * Because `CLAIMED` is a one-way gate in the bounty state machine, that both
 * burned B's chance to claim and — combined with the address IDOR — could
 * redirect the eventual payout.
 *
 * The fix is structural: the handler takes no body at all, so there is no field
 * left to spoof. These tests assert the identity actually reaching the service,
 * which is what decides `claimedById`.
 */
describe('BountiesController (#40 identity binding)', () => {
  let controller: BountiesController;
  let bountiesService: { claim: jest.Mock; fund: jest.Mock };
  let usersService: { assertOwnsStellarAddress: jest.Mock };

  beforeEach(async () => {
    bountiesService = {
      // Mirrors the real service: whatever id it is handed becomes claimedById.
      claim: jest.fn((id: string, contributorId: string) =>
        Promise.resolve({
          id,
          claimedById: contributorId,
          status: BountyStatus.CLAIMED,
        }),
      ),
      fund: jest.fn().mockResolvedValue({ id: 'bounty-1' }),
    };
    usersService = {
      assertOwnsStellarAddress: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BountiesController],
      providers: [
        { provide: BountiesService, useValue: bountiesService },
        { provide: UsersService, useValue: usersService },
        // These routes carry @Idempotent, which resolves
        // IdempotencyInterceptor through DI even though this suite calls
        // controller methods directly and never runs the interceptor.
        IdempotencyInterceptor,
        Reflector,
        { provide: getRepositoryToken(IdempotencyKey), useValue: {} },
      ],
    }).compile();

    controller = module.get(BountiesController);
  });

  describe('claim', () => {
    it('claims as the authenticated caller, not anyone named by the client', async () => {
      const bounty = (await controller.claim(
        'bounty-1',
        requestAs(USER_A),
      )) as { claimedById: string };

      expect(bountiesService.claim).toHaveBeenCalledWith('bounty-1', USER_A);
      expect(bounty.claimedById).toBe(USER_A);
    });

    it('authenticated user A cannot cause claimedById to be set to user B', async () => {
      // The pre-fix exploit: A authenticates as themselves and puts B's id in
      // the body. There is no longer a parameter to carry it — the only id the
      // handler can reach is the one the guard put on the request — so the
      // attempt cannot even be expressed, and B's id must appear nowhere in
      // what the service is told.
      const bounty = (await controller.claim(
        'bounty-1',
        requestAs(USER_A),
      )) as { claimedById: string };

      expect(bountiesService.claim).toHaveBeenCalledTimes(1);
      expect(bountiesService.claim).not.toHaveBeenCalledWith(
        expect.anything(),
        USER_B,
      );
      expect(bounty.claimedById).not.toBe(USER_B);
    });

    it('takes no request body, so no body field can influence the claimant', () => {
      // Guards against a regression that reintroduces a body parameter: the
      // handler's arity is part of the security property here. Bound because
      // the arity is all we want, not a callable detached from its instance.
      const handler = controller.claim.bind(controller);

      expect(handler).toHaveLength(2); // (id, req) — no body
    });

    it('two different callers claim as themselves', async () => {
      await controller.claim('bounty-1', requestAs(USER_A));
      await controller.claim('bounty-2', requestAs(USER_B));

      expect(bountiesService.claim).toHaveBeenNthCalledWith(
        1,
        'bounty-1',
        USER_A,
      );
      expect(bountiesService.claim).toHaveBeenNthCalledWith(
        2,
        'bounty-2',
        USER_B,
      );
    });
  });

  describe('fund', () => {
    it('checks funderAddress against the caller before funding', async () => {
      await controller.fund(
        'bounty-1',
        { funderAddress: 'GFUNDER' },
        requestAs(USER_A),
      );

      expect(usersService.assertOwnsStellarAddress).toHaveBeenCalledWith(
        USER_A,
        'GFUNDER',
      );
      expect(bountiesService.fund).toHaveBeenCalledWith('bounty-1', 'GFUNDER');
    });

    it("does not fund when the address is not the caller's own", async () => {
      usersService.assertOwnsStellarAddress.mockRejectedValue(
        new ForbiddenException(
          'funderAddress must match your linked Stellar address',
        ),
      );

      await expect(
        controller.fund(
          'bounty-1',
          { funderAddress: 'GSOMEONE_ELSE' },
          requestAs(USER_A),
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(bountiesService.fund).not.toHaveBeenCalled();
    });
  });
});
