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

  it('allows a user to update their own stellar address', async () => {
    const caller: AuthenticatedUser = {
      userId: 'user-1',
      username: 'alice',
      roles: [UserRole.CONTRIBUTOR],
    };

    const result = await controller.setStellarAddress(
      'user-1',
      { stellarAddress: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF' },
      caller,
    );

    expect(result.stellarAddress).toBe(
      'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF',
    );
    expect(usersService.setStellarAddress).toHaveBeenCalledWith(
      'user-1',
      'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF',
    );
  });

  it('throws 403 ForbiddenException when trying to patch another user address', async () => {
    const caller: AuthenticatedUser = {
      userId: 'user-2',
      username: 'bob',
      roles: [UserRole.CONTRIBUTOR],
    };

    expect(() =>
      controller.setStellarAddress(
        'user-1',
        { stellarAddress: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF' },
        caller,
      ),
    ).toThrow(ForbiddenException);

    expect(usersService.setStellarAddress).not.toHaveBeenCalled();
  });
});
