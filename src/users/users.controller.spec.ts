import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetStellarAddressDto, UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../common/enums';
import { PublicUserDto } from './dto/public-user.dto';

const VALID_STELLAR_ADDRESS =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const CHECKSUM_INVALID_ADDRESS =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLAA';
const SECRET_SEED = 'SDAKFNYEIAORZKKCYRILFQKLLOCNPL5SWJ3YYRPO3CACDTNZPT7XTTCV';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    list: jest.Mock;
    findById: jest.Mock;
    setStellarAddress: jest.Mock;
  };

  const sampleUser: PublicUserDto = {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'alice',
    displayName: 'Alice Liddell',
    avatarUrl: 'https://example.com/avatar.png',
    roles: [UserRole.CONTRIBUTOR],
    stellarAddress: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    usersService = {
      list: jest.fn().mockResolvedValue([sampleUser]),
      findById: jest.fn().mockResolvedValue(sampleUser),
      setStellarAddress: jest.fn().mockImplementation((id, address) =>
        Promise.resolve({
          ...sampleUser,
          id,
          stellarAddress: address,
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(UsersController);
  });

  describe('guard metadata (#597, #612)', () => {
    const handlerFor = (name: string) =>
      (
        UsersController.prototype as unknown as Record<
          string,
          (...args: unknown[]) => unknown
        >
      )[name];

    it('list is protected by JwtAuthGuard', () => {
      const guards = Reflect.getMetadata('__guards__', handlerFor('list'));
      expect(guards).toEqual([JwtAuthGuard]);
    });

    it('findOne is protected by JwtAuthGuard', () => {
      const guards = Reflect.getMetadata('__guards__', handlerFor('findOne'));
      expect(guards).toEqual([JwtAuthGuard]);
    });

    it('setStellarAddress is protected by JwtAuthGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        handlerFor('setStellarAddress'),
      );
      expect(guards).toEqual([JwtAuthGuard]);
    });
  });

  describe('list', () => {
    it('calls usersService.list and returns public users', async () => {
      const result = await controller.list();
      expect(usersService.list).toHaveBeenCalledTimes(1);
      expect(result).toEqual([sampleUser]);
    });
  });

  describe('findOne', () => {
    it('calls usersService.findById with route param id', async () => {
      const result = await controller.findOne(
        '00000000-0000-0000-0000-000000000001',
      );
      expect(usersService.findById).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000001',
      );
      expect(result).toEqual(sampleUser);
    });
  });

  describe('setStellarAddress (#39, #597)', () => {
    it('updates stellar address when authenticated user matches route id', async () => {
      const userId = '00000000-0000-0000-0000-000000000001';
      const caller = { userId, username: 'alice' };
      const dto: SetStellarAddressDto = {
        stellarAddress: VALID_STELLAR_ADDRESS,
      };

      const result = await controller.setStellarAddress(userId, dto, caller);

      expect(usersService.setStellarAddress).toHaveBeenCalledWith(
        userId,
        VALID_STELLAR_ADDRESS,
      );
      expect(result.stellarAddress).toBe(VALID_STELLAR_ADDRESS);
    });

    it('throws ForbiddenException when authenticated user attempts to modify another user address', () => {
      const targetUserId = '00000000-0000-0000-0000-000000000001';
      const attackerCaller = {
        userId: '00000000-0000-0000-0000-000000000002',
        username: 'mallory',
      };
      const dto: SetStellarAddressDto = {
        stellarAddress: VALID_STELLAR_ADDRESS,
      };

      expect(() =>
        controller.setStellarAddress(targetUserId, dto, attackerCaller),
      ).toThrow(ForbiddenException);
      expect(usersService.setStellarAddress).not.toHaveBeenCalled();
    });
  });

  describe('SetStellarAddressDto validation (#292, #597)', () => {
    it('accepts a valid StrKey Ed25519 public address', async () => {
      const dto = plainToInstance(SetStellarAddressDto, {
        stellarAddress: VALID_STELLAR_ADDRESS,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects an empty string', async () => {
      const dto = plainToInstance(SetStellarAddressDto, { stellarAddress: '' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects a non-Stellar string', async () => {
      const dto = plainToInstance(SetStellarAddressDto, {
        stellarAddress: 'not-an-address',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects an address with incorrect checksum', async () => {
      const dto = plainToInstance(SetStellarAddressDto, {
        stellarAddress: CHECKSUM_INVALID_ADDRESS,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects a secret key where a public key is required', async () => {
      const dto = plainToInstance(SetStellarAddressDto, {
        stellarAddress: SECRET_SEED,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects missing stellarAddress', async () => {
      const dto = plainToInstance(SetStellarAddressDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
