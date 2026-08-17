import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from '../common/entities';
import { UserRole } from '../common/enums';
import type { Request } from 'express';

function makeUser(id: string, email: string, username: string): User {
  const user = new User();
  user.id = id;
  user.email = email;
  user.username = username;
  user.displayName = username.toUpperCase();
  user.avatarUrl = null;
  user.roles = [UserRole.CONTRIBUTOR];
  user.stellarAddress = 'GSTELLARADDRESS';
  user.createdAt = new Date('2026-01-01');
  user.updatedAt = new Date('2026-01-02');
  user.githubAccount = null;
  return user;
}

describe('UsersController (Auth & PII Protection #64)', () => {
  let controller: UsersController;
  let usersService: {
    list: jest.Mock;
    findById: jest.Mock;
    setStellarAddress: jest.Mock;
  };

  const user1 = makeUser('user-1', 'alice@example.com', 'alice');
  const user2 = makeUser('user-2', 'bob@example.com', 'bob');

  beforeEach(async () => {
    usersService = {
      list: jest.fn().mockResolvedValue([user1, user2]),
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === 'user-1') return Promise.resolve(user1);
        if (id === 'user-2') return Promise.resolve(user2);
        return Promise.reject(new Error('User not found'));
      }),
      setStellarAddress: jest.fn().mockResolvedValue(user1),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get(UsersController);
  });

  describe('GET /users (list)', () => {
    it('redacts email for users other than the caller', async () => {
      const req = {
        user: { userId: 'user-1', username: 'alice', roles: [UserRole.CONTRIBUTOR] },
      } as unknown as Request;

      const result = await controller.list(req);

      expect(result).toHaveLength(2);
      // Own user keeps email
      expect(result[0].id).toBe('user-1');
      expect(result[0].email).toBe('alice@example.com');

      // Other user has email redacted
      expect(result[1].id).toBe('user-2');
      expect(result[1]).not.toHaveProperty('email');
    });
  });

  describe('GET /users/:id (findOne)', () => {
    it('returns email when fetching own profile', async () => {
      const req = {
        user: { userId: 'user-1', username: 'alice', roles: [UserRole.CONTRIBUTOR] },
      } as unknown as Request;

      const result = await controller.findOne('user-1', req);
      expect(result.id).toBe('user-1');
      expect(result.email).toBe('alice@example.com');
    });

    it('redacts email when fetching another user profile', async () => {
      const req = {
        user: { userId: 'user-1', username: 'alice', roles: [UserRole.CONTRIBUTOR] },
      } as unknown as Request;

      const result = await controller.findOne('user-2', req);
      expect(result.id).toBe('user-2');
      expect(result).not.toHaveProperty('email');
      expect(result.username).toBe('bob');
    });
  });
});
