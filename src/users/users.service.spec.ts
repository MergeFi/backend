import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { GithubAccount, User } from '../common/entities';
import { UserRole } from '../common/enums';

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let githubAccountRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      save: jest.fn((u: Partial<User>) => Promise.resolve({ id: 'u1', ...u })),
      create: jest.fn((u: Partial<User>) => u),
    };
    githubAccountRepo = {
      findOne: jest.fn(),
      save: jest.fn((a: Partial<GithubAccount>) =>
        Promise.resolve({ id: 'ga1', ...a }),
      ),
      create: jest.fn((a: Partial<GithubAccount>) => a),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(GithubAccount),
          useValue: githubAccountRepo,
        },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findById', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('maps the user to its public shape, excluding private fields', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'u1',
        username: 'octocat',
        displayName: 'The Octocat',
        avatarUrl: 'https://example.com/a.png',
        roles: [UserRole.CONTRIBUTOR],
        stellarAddress: 'GADDRESS',
        email: 'octocat@example.com',
        createdAt: new Date('2026-01-01'),
      });

      const dto = await service.findById('u1');

      expect(dto).toEqual({
        id: 'u1',
        username: 'octocat',
        displayName: 'The Octocat',
        avatarUrl: 'https://example.com/a.png',
        roles: [UserRole.CONTRIBUTOR],
        stellarAddress: 'GADDRESS',
        createdAt: new Date('2026-01-01'),
      });
      expect(dto).not.toHaveProperty('email');
    });
  });

  describe('findByUsername', () => {
    it('returns null when no user matches', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.findByUsername('nobody')).resolves.toBeNull();
    });

    it('returns the raw user entity when found', async () => {
      const user = { id: 'u1', username: 'octocat' };
      userRepo.findOne.mockResolvedValue(user);
      await expect(service.findByUsername('octocat')).resolves.toBe(user);
    });
  });

  describe('upsertFromGithub', () => {
    const input = {
      githubId: 'gh-1',
      login: 'octocat',
      email: 'octocat@example.com',
      displayName: 'The Octocat',
      avatarUrl: 'https://example.com/a.png',
      profileUrl: 'https://github.com/octocat',
      accessToken: 'token-abc',
      refreshToken: 'refresh-abc',
    };

    it('creates a new User + GithubAccount when neither exists', async () => {
      githubAccountRepo.findOne.mockResolvedValue(null);
      userRepo.findOne
        .mockResolvedValueOnce(null) // lookup by username before create
        .mockResolvedValueOnce({
          id: 'u1',
          username: 'octocat',
          githubAccount: { id: 'ga1' },
        }); // findOneRaw at the end

      const user = await service.upsertFromGithub(input);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'octocat',
          email: 'octocat@example.com',
          roles: [UserRole.CONTRIBUTOR],
        }),
      );
      expect(githubAccountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ githubId: 'gh-1', userId: 'u1' }),
      );
      expect(user.id).toBe('u1');
    });

    it('links to an existing user found by username instead of creating a duplicate', async () => {
      githubAccountRepo.findOne.mockResolvedValue(null);
      userRepo.findOne
        .mockResolvedValueOnce({ id: 'existing-user', username: 'octocat' })
        .mockResolvedValueOnce({ id: 'existing-user', username: 'octocat' });

      await service.upsertFromGithub(input);

      expect(userRepo.create).not.toHaveBeenCalled();
      expect(githubAccountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'existing-user' }),
      );
    });

    it('refreshes tokens on an already-linked GithubAccount without creating a new user', async () => {
      const account = {
        id: 'ga1',
        githubId: 'gh-1',
        userId: 'u1',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
      };
      githubAccountRepo.findOne.mockResolvedValue(account);
      userRepo.findOne.mockResolvedValue({ id: 'u1', username: 'octocat' });

      await service.upsertFromGithub(input);

      expect(userRepo.create).not.toHaveBeenCalled();
      expect(githubAccountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'token-abc',
          refreshToken: 'refresh-abc',
        }),
      );
    });

    it('stores a null refreshToken when GitHub does not return one', async () => {
      githubAccountRepo.findOne.mockResolvedValue(null);
      userRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'u1', username: 'octocat' });

      const { refreshToken, ...inputWithoutRefresh } = input;
      void refreshToken;
      await service.upsertFromGithub(inputWithoutRefresh);

      expect(githubAccountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ refreshToken: null }),
      );
    });
  });

  describe('setStellarAddress', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.setStellarAddress('missing', 'GADDRESS'),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets stellarAddress on the given user and persists it', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', stellarAddress: null });

      const user = await service.setStellarAddress('u1', 'GNEWADDRESS');

      expect(user.stellarAddress).toBe('GNEWADDRESS');
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1', stellarAddress: 'GNEWADDRESS' }),
      );
    });

    // Note on #39 (UsersController.setStellarAddress is authenticated but
    // not authorized: any logged-in user can overwrite another user's
    // payout address): UsersService.setStellarAddress(userId, address) has
    // no notion of "who is asking" in its own signature — by design it sets
    // whichever userId it's given. The IDOR itself lives one layer up, in
    // UsersController#setStellarAddress binding :id straight from the URL
    // param instead of the authenticated req.user.id (see
    // src/users/users.controller.ts). That controller has no spec file
    // today and is out of this issue's listed scope (only
    // users.service.spec.ts is asked for here) — a
    // users.controller.spec.ts with the cross-user rejection test belongs
    // with #39's fix, since only the controller layer has enough
    // information (the authenticated caller's identity) to write a
    // meaningful assertion for it. Documented here so the boundary isn't
    // silently lost.
    it('[documents scope of #39] setStellarAddress itself has no caller/authorization concept — see users.controller.ts', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'victim',
        stellarAddress: 'GOLD',
      });

      // Nothing about this call's parameters distinguishes "the account
      // owner is changing their own address" from "some other authenticated
      // user is overwriting someone else's" — both look identical to the
      // service.
      const user = await service.setStellarAddress('victim', 'GATTACKER');

      expect(user.stellarAddress).toBe('GATTACKER');
    });
  });

  describe('list', () => {
    it('returns every user mapped to its public shape', async () => {
      userRepo.find = jest.fn().mockResolvedValue([
        {
          id: 'u1',
          username: 'a',
          roles: [],
          stellarAddress: null,
          createdAt: new Date(),
        },
        {
          id: 'u2',
          username: 'b',
          roles: [],
          stellarAddress: null,
          createdAt: new Date(),
        },
      ]);

      const users = await service.list();

      expect(users).toHaveLength(2);
      expect(users[0]).not.toHaveProperty('email');
    });
  });
});
