import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<Partial<UsersService>>;

  beforeEach(async () => {
    usersService = {
      list: jest.fn(),
      findById: jest.fn(),
      setStellarAddress: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  describe('setStellarAddress (#39 IDOR guard)', () => {
    const validDto = {
      stellarAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    };

    it('allows a user to update their own payout address', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      const req = { user: { userId } } as any;
      const expectedUser = { id: userId, stellarAddress: validDto.stellarAddress } as any;
      usersService.setStellarAddress.mockResolvedValue(expectedUser);

      const result = await controller.setStellarAddress(userId, validDto, req);

      expect(result).toEqual(expectedUser);
      expect(usersService.setStellarAddress).toHaveBeenCalledWith(userId, validDto.stellarAddress);
    });

    it('throws ForbiddenException when user A attempts to overwrite user B address', async () => {
      const victimId = '11111111-1111-1111-1111-111111111111';
      const attackerId = '22222222-2222-2222-2222-222222222222';
      const req = { user: { userId: attackerId } } as any;

      expect(() => controller.setStellarAddress(victimId, validDto, req)).toThrow(
        ForbiddenException,
      );
      expect(usersService.setStellarAddress).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when req.user is missing or lacks userId', async () => {
      const targetId = '11111111-1111-1111-1111-111111111111';
      const req = {} as any;

      expect(() => controller.setStellarAddress(targetId, validDto, req)).toThrow(
        ForbiddenException,
      );
      expect(usersService.setStellarAddress).not.toHaveBeenCalled();
    });
  });
});
