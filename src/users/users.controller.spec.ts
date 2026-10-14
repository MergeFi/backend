import { ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';

describe('UsersController (#597)', () => {
  const usersService = {
    list: jest.fn(),
    findById: jest.fn(),
    setStellarAddress: jest.fn(),
  } as unknown as UsersService;
  const controller = new UsersController(usersService);

  it('list delegates to usersService.list', async () => {
    usersService.list = jest.fn().mockResolvedValue([{ id: 'u1' }]);
    await expect(controller.list()).resolves.toEqual([{ id: 'u1' }]);
    expect(usersService.list).toHaveBeenCalled();
  });

  it('findOne delegates with the parsed id', async () => {
    usersService.findById = jest.fn().mockResolvedValue({ id: 'u1' });
    await controller.findOne('u1');
    expect(usersService.findById).toHaveBeenCalledWith('u1');
  });

  it('setStellarAddress delegates for the authenticated self', async () => {
    usersService.setStellarAddress = jest
      .fn()
      .mockResolvedValue({ stellarAddress: 'G...' });
    const req = { user: { userId: 'u1' } } as never;
    await controller.setStellarAddress(
      'u1',
      { stellarAddress: 'GABC' } as never,
      req,
    );
    expect(usersService.setStellarAddress).toHaveBeenCalledWith('u1', 'GABC');
  });

  // The self-only check (#39) — anyone setting ANOTHER user's stellar-address
  // (the on-chain payout recipient) is a payout-hijack. Must 403.
  it("setStellarAddress rejects setting another user's address", async () => {
    const req = { user: { userId: 'attacker' } } as never;
    await expect(
      controller.setStellarAddress(
        'victim-id',
        { stellarAddress: 'GABC' } as never,
        req,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersService.setStellarAddress).not.toHaveBeenCalled();
  });

  it('all routes are behind JwtAuthGuard', () => {
    const reflector = new Reflector();
    for (const method of ['list', 'findOne', 'setStellarAddress'] as const) {
      const guards = reflector.get(
        GUARDS_METADATA,
        UsersController.prototype[method],
      );
      expect(guards).toContain(JwtAuthGuard);
    }
  });
});
