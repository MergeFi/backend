import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { User } from '../../common/entities';
import { UserRole } from '../../common/enums';
import { EscrowController } from '../../escrow/escrow.controller';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const context = (user?: { userId: string }) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;

  let guard: RolesGuard;

  beforeEach(async () => {
    jest.clearAllMocks();
    guard = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: reflector },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    })
      .compile()
      .then((module) => module.get(RolesGuard));
  });

  it('allows an authenticated user with a required role', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.MAINTAINER]);
    userRepo.findOne.mockResolvedValue({ roles: [UserRole.MAINTAINER] });

    await expect(
      guard.canActivate(context({ userId: 'user-1' })),
    ).resolves.toBe(true);
  });

  it('denies an authenticated user without a required role', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SPONSOR]);
    userRepo.findOne.mockResolvedValue({ roles: [UserRole.CONTRIBUTOR] });

    await expect(
      guard.canActivate(context({ userId: 'user-1' })),
    ).resolves.toBe(false);
  });

  it('rejects requests that did not pass JWT authentication', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SPONSOR]);

    await expect(guard.canActivate(context())).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

/**
 * The cases above mock the Reflector, so the real metadata path — the part
 * that can break silently, since the guard allows when metadata is absent —
 * is exercised only here, against real decorated controllers (#838).
 */
describe('RolesGuard with the real Reflector (#838)', () => {
  const userRepo = { findOne: jest.fn() };
  let guard: RolesGuard;

  const contextFor = <T>(
    controller: new (...args: never[]) => T,
    method: keyof T,
  ) =>
    ({
      getHandler: () => controller.prototype[method] as object,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'user-1' } }),
      }),
    }) as never;

  beforeEach(async () => {
    jest.clearAllMocks();
    guard = await Test.createTestingModule({
      providers: [
        RolesGuard,
        Reflector,
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    })
      .compile()
      .then((module) => module.get(RolesGuard));
  });

  it('enforces @Roles on a production route (EscrowController.release)', async () => {
    userRepo.findOne.mockResolvedValue({ roles: [UserRole.CONTRIBUTOR] });

    await expect(
      guard.canActivate(contextFor(EscrowController, 'release')),
    ).resolves.toBe(false);
    expect(userRepo.findOne).toHaveBeenCalled();
  });

  it('admits a holder of a role listed by @Roles on a production route', async () => {
    userRepo.findOne.mockResolvedValue({ roles: [UserRole.SPONSOR] });

    await expect(
      guard.canActivate(contextFor(EscrowController, 'refund')),
    ).resolves.toBe(true);
  });

  it('allows an undecorated handler without consulting the database', async () => {
    class PlainController {
      open() {}
    }

    await expect(
      guard.canActivate(contextFor(PlainController, 'open')),
    ).resolves.toBe(true);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });
});
