import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash, generateKeyPairSync, sign } from 'crypto';
import { StrKey } from '@stellar/stellar-sdk';
import { UsersService } from './users.service';
import {
  GithubAccount,
  StellarAddressChallenge,
  User,
} from '../common/entities';
import { UserRole } from '../common/enums';

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let githubAccountRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let challengeRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let config: { getOrThrow: jest.Mock };

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

    challengeRepo = {
      findOne: jest.fn(),
      save: jest.fn((c: Partial<StellarAddressChallenge>) =>
        Promise.resolve({ id: 'c1', consumedAt: null, ...c }),
      ),
      create: jest.fn((c: Partial<StellarAddressChallenge>) => c),
      update: jest.fn(),
    };
    config = {
      getOrThrow: jest.fn().mockReturnValue('https://app.mergefi.test'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(GithubAccount),
          useValue: githubAccountRepo,
        },
        {
          provide: getRepositoryToken(StellarAddressChallenge),
          useValue: challengeRepo,
        },
        { provide: ConfigService, useValue: config },
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
      userRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.username === 'octocat') return null;
        if (where?.email === 'octocat@example.com') return null;
        if (where?.id === 'u1') {
          return {
            id: 'u1',
            username: 'octocat',
            githubAccount: { id: 'ga1' },
          };
        }
        return null;
      });

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

    it('prevents username-based takeover: creates a new user when username is taken by another GitHub identity', async () => {
      githubAccountRepo.findOne.mockResolvedValue(null);
      // 'octocat' is already owned by Alice; Bob (gh-1) must not be linked to her.
      userRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.username === 'octocat')
          return { id: 'alice-id', username: 'octocat' };
        if (where?.username === 'octocat-1') return null;
        if (where?.email === 'octocat@example.com') return null;
        if (where?.id === 'u1') {
          return {
            id: 'u1',
            username: 'octocat-1',
            githubAccount: { id: 'ga1' },
          };
        }
        return null;
      });

      await service.upsertFromGithub(input);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'octocat-1' }),
      );
      expect(githubAccountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ githubId: 'gh-1', userId: 'u1' }),
      );
      expect(githubAccountRepo.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'alice-id' }),
      );
    });

    it('refreshes tokens on an already-linked GithubAccount without creating a new user', async () => {
      const account = {
        id: 'ga1',
        githubId: 'gh-1',
        userId: 'u1',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        login: 'octocat',
      };
      githubAccountRepo.findOne.mockResolvedValue(account);
      userRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'u1') {
          return {
            id: 'u1',
            username: 'octocat',
            displayName: 'The Octocat',
            avatarUrl: 'https://example.com/a.png',
            email: 'octocat@example.com',
          };
        }
        return null;
      });

      await service.upsertFromGithub(input);

      expect(userRepo.create).not.toHaveBeenCalled();
      expect(githubAccountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'token-abc',
          refreshToken: 'refresh-abc',
          login: 'octocat',
        }),
      );
    });

    it('syncs stale User profile fields from the fresh GitHub profile on re-login', async () => {
      const account = {
        id: 'ga1',
        githubId: 'gh-1',
        userId: 'u1',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        login: 'old-name',
        avatarUrl: 'https://example.com/old.png',
        profileUrl: 'https://github.com/old-name',
      };
      githubAccountRepo.findOne.mockResolvedValue(account);
      const staleUser = {
        id: 'u1',
        username: 'old-name',
        displayName: 'Old Name',
        avatarUrl: 'https://example.com/old.png',
        email: 'old@example.com',
      };
      const updatedUser = {
        ...staleUser,
        username: 'octocat',
        displayName: 'The Octocat',
        avatarUrl: 'https://example.com/a.png',
        email: 'octocat@example.com',
      };
      // findOneRaw first call returns stale, second call after save returns updated
      userRepo.findOne
        .mockResolvedValueOnce(staleUser) // first findOneRaw for sync
        .mockResolvedValueOnce(null) // check username uniqueness for "octocat"
        .mockResolvedValueOnce(null) // check email uniqueness
        .mockResolvedValueOnce(updatedUser); // final findOneRaw
      userRepo.save.mockImplementation(async (u: any) => u);

      const user = await service.upsertFromGithub(input);

      expect(githubAccountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          login: 'octocat',
          avatarUrl: 'https://example.com/a.png',
        }),
      );
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'octocat',
          displayName: 'The Octocat',
          avatarUrl: 'https://example.com/a.png',
          email: 'octocat@example.com',
        }),
      );
      expect(user.username).toBe('octocat');
    });

    it('stores a null refreshToken when GitHub does not return one', async () => {
      githubAccountRepo.findOne.mockResolvedValue(null);
      userRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.username === 'octocat') return null;
        if (where?.email === 'octocat@example.com') return null;
        if (where?.id === 'u1') return { id: 'u1', username: 'octocat' };
        return null;
      });

      const { refreshToken, ...inputWithoutRefresh } = input;
      void refreshToken;
      await service.upsertFromGithub(inputWithoutRefresh);

      expect(githubAccountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ refreshToken: null }),
      );
    });
  });

  describe('setStellarAddress (#791 proof of ownership)', () => {
    // A real Ed25519 keypair. The address is the StrKey encoding of its public
    // key, and the signature follows SEP-53 (sha256 of the prefixed message),
    // the same scheme Freighter's signMessage uses.
    function makeWallet() {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const raw = Buffer.from(
        (publicKey.export({ format: 'jwk' }) as { x: string }).x,
        'base64url',
      );
      return {
        address: StrKey.encodeEd25519PublicKey(raw),
        sign: (message: string) =>
          sign(
            null,
            createHash('sha256')
              .update('Stellar Signed Message:\n' + message, 'utf8')
              .digest(),
            privateKey,
          ).toString('base64'),
      };
    }

    // Stored challenge row, kept in step with challengeRepo so the claim
    // UPDATE and later lookups see the same state the database would.
    let stored: StellarAddressChallenge | null;

    function wireChallengeRepo(): void {
      challengeRepo.findOne.mockImplementation(
        async ({ where }: { where: { nonce: string; userId: string } }) =>
          stored &&
          where.nonce === stored.nonce &&
          where.userId === stored.userId
            ? stored
            : null,
      );
      challengeRepo.update.mockImplementation(
        async (
          criteria: { id: string; consumedAt: unknown },
          partial: { consumedAt: Date },
        ) => {
          if (stored && criteria.id === stored.id && stored.consumedAt === null) {
            stored.consumedAt = partial.consumedAt;
            return { affected: 1 };
          }
          return { affected: 0 };
        },
      );
    }

    async function issueChallenge(userId: string, address: string) {
      const result = await service.issueStellarAddressChallenge(userId, address);
      const row = challengeRepo.save.mock.calls.at(-1)![0];
      stored = { id: 'c1', consumedAt: null, ...row } as StellarAddressChallenge;
      return result;
    }

    beforeEach(() => {
      stored = null;
      wireChallengeRepo();
      userRepo.findOne.mockResolvedValue({ id: 'u1', stellarAddress: null });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.setStellarAddress('missing', {
          stellarAddress: 'GADDRESS',
          nonce: 'n',
          message: 'm',
          signature: 's',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets the address when the signature is valid for a live challenge', async () => {
      const wallet = makeWallet();
      const { nonce, message } = await issueChallenge('u1', wallet.address);

      const user = await service.setStellarAddress('u1', {
        stellarAddress: wallet.address,
        nonce,
        message,
        signature: wallet.sign(message),
      });

      expect(user.stellarAddress).toBe(wallet.address);
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1', stellarAddress: wallet.address }),
      );
      expect(stored!.consumedAt).toBeInstanceOf(Date);
    });

    it('rejects a PATCH without a valid signature and does not write the address', async () => {
      const wallet = makeWallet();
      const { nonce, message } = await issueChallenge('u1', wallet.address);

      await expect(
        service.setStellarAddress('u1', {
          stellarAddress: wallet.address,
          nonce,
          message,
          signature: '',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a signature made by a different key than the claimed address', async () => {
      const owner = makeWallet();
      const attacker = makeWallet();
      const { nonce, message } = await issueChallenge('u1', owner.address);

      await expect(
        service.setStellarAddress('u1', {
          stellarAddress: owner.address,
          nonce,
          message,
          signature: attacker.sign(message),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a replayed nonce', async () => {
      const wallet = makeWallet();
      const { nonce, message } = await issueChallenge('u1', wallet.address);
      const body = {
        stellarAddress: wallet.address,
        nonce,
        message,
        signature: wallet.sign(message),
      };

      await service.setStellarAddress('u1', body);
      userRepo.save.mockClear();

      await expect(service.setStellarAddress('u1', body)).rejects.toThrow(
        ForbiddenException,
      );
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects when two requests race and only one claims the nonce', async () => {
      const wallet = makeWallet();
      const { nonce, message } = await issueChallenge('u1', wallet.address);
      const body = {
        stellarAddress: wallet.address,
        nonce,
        message,
        signature: wallet.sign(message),
      };
      // Both requests pass the read-side checks; the database claim then
      // reports that the other request already consumed the row.
      challengeRepo.update.mockResolvedValueOnce({ affected: 0 });

      await expect(service.setStellarAddress('u1', body)).rejects.toThrow(
        ForbiddenException,
      );
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects an expired challenge even with a valid signature', async () => {
      const wallet = makeWallet();
      const { nonce, message } = await issueChallenge('u1', wallet.address);
      stored!.expiresAt = new Date(Date.now() - 1000);

      await expect(
        service.setStellarAddress('u1', {
          stellarAddress: wallet.address,
          nonce,
          message,
          signature: wallet.sign(message),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a message the server did not issue, even if it was signed', async () => {
      const wallet = makeWallet();
      const { nonce } = await issueChallenge('u1', wallet.address);
      const forged = 'please link my address';

      await expect(
        service.setStellarAddress('u1', {
          stellarAddress: wallet.address,
          nonce,
          message: forged,
          signature: wallet.sign(forged),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a challenge issued for a different address than the one claimed', async () => {
      const issuedFor = makeWallet();
      const claimed = makeWallet();
      const { nonce, message } = await issueChallenge('u1', issuedFor.address);

      await expect(
        service.setStellarAddress('u1', {
          stellarAddress: claimed.address,
          nonce,
          message,
          signature: claimed.sign(message),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a challenge that belongs to another user', async () => {
      const wallet = makeWallet();
      const { nonce, message } = await issueChallenge('u2', wallet.address);

      await expect(
        service.setStellarAddress('u1', {
          stellarAddress: wallet.address,
          nonce,
          message,
          signature: wallet.sign(message),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('issueStellarAddressChallenge (#791)', () => {
    it('returns a message bound to the address, user, domain and a fresh nonce', async () => {
      const address = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));

      const { message, nonce, expiresAt } =
        await service.issueStellarAddressChallenge('u1', address);

      expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(message).toContain('app.mergefi.test');
      expect(message).toContain(`Address: ${address}`);
      expect(message).toContain('User ID: u1');
      expect(message).toContain(`Nonce: ${nonce}`);
      const ttl = expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(4 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(5 * 60 * 1000);
    });

    it('persists the challenge row the PATCH will later verify against', async () => {
      const address = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));

      const { message, nonce } = await service.issueStellarAddressChallenge(
        'u1',
        address,
      );

      expect(challengeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          stellarAddress: address,
          nonce,
          message,
        }),
      );
    });

    it('issues a different nonce on every call', async () => {
      const address = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
      const a = await service.issueStellarAddressChallenge('u1', address);
      const b = await service.issueStellarAddressChallenge('u1', address);
      expect(a.nonce).not.toBe(b.nonce);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.issueStellarAddressChallenge('missing', 'GADDRESS'),
      ).rejects.toThrow(NotFoundException);
      expect(challengeRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('clearStellarAddress', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.clearStellarAddress('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('sets stellarAddress to null and persists the change (#714)', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'u1',
        stellarAddress: 'GLINKEDADDRESS',
      });

      const user = await service.clearStellarAddress('u1');

      expect(user.stellarAddress).toBeNull();
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1', stellarAddress: null }),
      );
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
