import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticatedRequest, UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from '../common/entities';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    list: jest.fn(),
    findById: jest.fn(),
    setStellarAddress: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    jest.clearAllMocks();
  });

  describe('setStellarAddress', () => {
    it('allows a user to update their own stellar address', async () => {
      const userId = 'user-123';
      const dto = {
        stellarAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      };
      const req = {
        user: { userId: 'user-123', username: 'alice' },
      } as unknown as AuthenticatedRequest;
      const updatedUser = {
        id: userId,
        stellarAddress: dto.stellarAddress,
      } as User;

      mockUsersService.setStellarAddress.mockResolvedValue(updatedUser);

      const result = await controller.setStellarAddress(userId, dto, req);

      expect(mockUsersService.setStellarAddress).toHaveBeenCalledWith(
        userId,
        dto.stellarAddress,
      );
      expect(result).toEqual(updatedUser);
    });

    it('rejects update when authenticated user does not match the target id (403 Forbidden)', () => {
      const targetUserId = 'user-target-456';
      const dto = {
        stellarAddress:
          'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      };
      const req = {
        user: { userId: 'user-attacker-123', username: 'eve' },
      } as unknown as AuthenticatedRequest;

      expect(() =>
        controller.setStellarAddress(targetUserId, dto, req),
      ).toThrow(ForbiddenException);

      expect(mockUsersService.setStellarAddress).not.toHaveBeenCalled();
    });
  });
});
