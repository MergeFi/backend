import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PublicUserDto } from './dto/public-user.dto';
import { UserRole } from '../common/enums';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    list: jest.Mock;
    findById: jest.Mock;
    setStellarAddress: jest.Mock;
    issueStellarAddressChallenge: jest.Mock;
    clearStellarAddress: jest.Mock;
  };

  const mockPublicUser: PublicUserDto = {
    id: 'user-1',
    username: 'alice',
    displayName: 'Alice Cooper',
    avatarUrl: 'https://avatar.com/1',
    roles: [UserRole.CONTRIBUTOR],
    stellarAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    usersService = {
      list: jest.fn().mockResolvedValue([mockPublicUser]),
      findById: jest.fn().mockResolvedValue(mockPublicUser),
      setStellarAddress: jest.fn().mockResolvedValue({
        ...mockPublicUser,
        stellarAddress: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF',
      }),
      issueStellarAddressChallenge: jest.fn().mockResolvedValue({
        message: 'app.mergefi.test wants you to prove...',
        nonce: 'NONCE1',
        expiresAt: new Date(),
      }),
      clearStellarAddress: jest
        .fn()
        .mockResolvedValue({ ...mockPublicUser, stellarAddress: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get(UsersController);
  });

  it('lists public users', async () => {
    const result = await controller.list();
    expect(result).toEqual([mockPublicUser]);
    expect(usersService.list).toHaveBeenCalled();
  });

  it('finds a user by id and returns public DTO shape', async () => {
    const result = await controller.findOne('user-1');
    expect(result).toEqual(mockPublicUser);
    expect(usersService.findById).toHaveBeenCalledWith('user-1');
  });

  const proofBody = {
    stellarAddress: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF',
    nonce: 'NONCE1',
    message: 'app.mergefi.test wants you to prove...',
    signature: 'c2ln',
  };

  it('allows a user to update their own stellar address with a signed proof', async () => {
    const caller: AuthenticatedUser = {
      userId: 'user-1',
      username: 'alice',
      roles: [UserRole.CONTRIBUTOR],
    };

    const result = await controller.setStellarAddress('user-1', proofBody, caller);

    expect(result.stellarAddress).toBe(
      'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF',
    );
    expect(usersService.setStellarAddress).toHaveBeenCalledWith('user-1', {
      stellarAddress: proofBody.stellarAddress,
      nonce: 'NONCE1',
      message: proofBody.message,
      signature: 'c2ln',
    });
  });

  it('throws 403 ForbiddenException when trying to patch another user address', async () => {
    const caller: AuthenticatedUser = {
      userId: 'user-2',
      username: 'bob',
      roles: [UserRole.CONTRIBUTOR],
    };

    expect(() =>
      controller.setStellarAddress('user-1', proofBody, caller),
    ).toThrow(ForbiddenException);

    expect(usersService.setStellarAddress).not.toHaveBeenCalled();
  });

  describe('issueStellarAddressChallenge (POST :id/stellar-address/challenge) (#791)', () => {
    it('issues a challenge for the authenticated user', async () => {
      const caller: AuthenticatedUser = {
        userId: 'user-1',
        username: 'alice',
        roles: [UserRole.CONTRIBUTOR],
      };

      const result = await controller.issueStellarAddressChallenge(
        'user-1',
        { stellarAddress: proofBody.stellarAddress },
        caller,
      );

      expect(result.nonce).toBe('NONCE1');
      expect(usersService.issueStellarAddressChallenge).toHaveBeenCalledWith(
        'user-1',
        proofBody.stellarAddress,
      );
    });

    it('throws 403 ForbiddenException when requesting a challenge for another user', async () => {
      const caller: AuthenticatedUser = {
        userId: 'user-2',
        username: 'bob',
        roles: [UserRole.CONTRIBUTOR],
      };

      expect(() =>
        controller.issueStellarAddressChallenge(
          'user-1',
          { stellarAddress: proofBody.stellarAddress },
          caller,
        ),
      ).toThrow(ForbiddenException);
      expect(usersService.issueStellarAddressChallenge).not.toHaveBeenCalled();
    });
  });

  describe('clearStellarAddress (DELETE :id/stellar-address) (#714)', () => {
    it('clears the stellar address for the authenticated user', async () => {
      const caller: AuthenticatedUser = {
        userId: 'user-1',
        username: 'alice',
        roles: [UserRole.CONTRIBUTOR],
      };

      const result = await controller.clearStellarAddress('user-1', caller);

      expect(result.stellarAddress).toBeNull();
      expect(usersService.clearStellarAddress).toHaveBeenCalledWith('user-1');
    });

    it('throws 403 ForbiddenException when trying to clear another user address', async () => {
      const caller: AuthenticatedUser = {
        userId: 'user-2',
        username: 'bob',
        roles: [UserRole.CONTRIBUTOR],
      };

      expect(() =>
        controller.clearStellarAddress('user-1', caller),
      ).toThrow(ForbiddenException);

      expect(usersService.clearStellarAddress).not.toHaveBeenCalled();
    });
  });
});
