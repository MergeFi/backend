import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { User } from '../../common/entities';
import { UserRole } from '../../common/enums';
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
