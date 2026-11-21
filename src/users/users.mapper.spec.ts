import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import { GithubAccount } from '../common/entities/github-account.entity';
import { User } from '../common/entities/user.entity';
import { UserRole } from '../common/enums';
import { PublicUserDto } from './dto/public-user.dto';
import { toPublicUser } from './users.mapper';
import { PublicUserDto } from './dto/public-user.dto';

/**
 * toPublicUser is the only barrier between the User entity and every
 * user-facing read (findById, list, setStellarAddress, clearStellarAddress),
 * and the entity it receives carries the nested githubAccount with its
 * encrypted tokens (#359, #847). Every assertion below is on *exact* keys, so
 * a field added to User or PublicUserDto fails a test until it is
 * deliberately classified as public or private here.
 */
const PUBLIC_USER_KEYS = [
  'avatarUrl',
  'createdAt',
  'displayName',
  'id',
  'roles',
  'stellarAddress',
  'username',
];

/** User properties that must never reach a public response. */
const PRIVATE_USER_KEYS = [
  'email',
  'githubAccount',
  'tokenVersion',
  'updatedAt',
];

/** Where @ApiProperty records a DTO's documented keys (`:name` entries). */
const SWAGGER_PROPERTIES_KEY = 'swagger/apiModelPropertiesArray';

/** Every column and relation TypeORM knows on an entity class. */
function entityProperties(target: object): string[] {
  const storage = getMetadataArgsStorage();
  return [
    ...storage.columns.filter((c) => c.target === target),
    ...storage.relations.filter((r) => r.target === target),
  ]
    .map((c) => c.propertyName)
    .sort();
}

/** A User with every column populated, as findOneRaw returns it. */
function fullyLoadedUser(): User {
  const githubAccount = Object.assign(new GithubAccount(), {
    id: 1,
    login: 'alice',
    githubId: '1001',
    avatarUrl: 'https://example.com/gh.png',
    profileUrl: 'https://github.com/alice',
    userId: 'usr_123',
    accessToken: 'gho_secret_token',
    refreshToken: 'ghr_refresh_token',
  });
  return Object.assign(new User(), {
    id: 'usr_123',
    email: 'alice@secret.com',
    username: 'alice',
    displayName: 'Alice In Chains',
    avatarUrl: 'https://example.com/avatar.png',
    roles: [UserRole.CONTRIBUTOR],
    tokenVersion: 3,
    stellarAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLBCIN32OWTACPOHXCDK23MZMXXMIHAAAA',
    githubAccount,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
  });
}

describe('users.mapper', () => {
  describe('toPublicUser', () => {
    it('returns exactly the public keys, nothing more (#847)', () => {
      const result = toPublicUser(fullyLoadedUser());

      expect(Object.keys(result).sort()).toEqual(PUBLIC_USER_KEYS);
    });

    it('returns the public values unchanged', () => {
      expect(toPublicUser(fullyLoadedUser())).toEqual({
        id: 'usr_123',
        username: 'alice',
        displayName: 'Alice In Chains',
        avatarUrl: 'https://example.com/avatar.png',
        roles: [UserRole.CONTRIBUTOR],
        stellarAddress:
          'GBRPYHIL2CI3FNQ4BXLFMNDLBCIN32OWTACPOHXCDK23MZMXXMIHAAAA',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
    });

    it('never serialises email or any githubAccount field, tokens included', () => {
      const json = JSON.stringify(toPublicUser(fullyLoadedUser()));

      for (const secret of [
        'alice@secret.com',
        'gho_secret_token',
        'ghr_refresh_token',
        'githubAccount',
        'https://github.com/alice',
      ]) {
        expect(json).not.toContain(secret);
      }
    });

    it('does not pass through properties the entity gains at runtime', () => {
      const user = Object.assign(fullyLoadedUser(), {
        passwordHash: 'leak',
      });

      expect(Object.keys(toPublicUser(user)).sort()).toEqual(PUBLIC_USER_KEYS);
    });
  });

  describe('classification', () => {
    // A new User column fails here until it is added to one of the two lists,
    // so nothing becomes public (or silently private) by default.
    it('classifies every User column and relation as public or private', () => {
      expect(entityProperties(User)).toEqual(
        [...PUBLIC_USER_KEYS, ...PRIVATE_USER_KEYS].sort(),
      );
    });

    it('keeps the public and private lists disjoint', () => {
      const overlap = PUBLIC_USER_KEYS.filter((k) =>
        PRIVATE_USER_KEYS.includes(k),
      );
      expect(overlap).toEqual([]);
    });
  });

  describe('PublicUserDto', () => {
    it('documents exactly the public keys (#847)', () => {
      const documented = (
        Reflect.getMetadata(
          SWAGGER_PROPERTIES_KEY,
          PublicUserDto.prototype,
        ) as string[]
      ).map((key) => key.replace(/^:/, ''));

      expect(documented.sort()).toEqual(PUBLIC_USER_KEYS);
    });

    it('has a key set the compiler holds to the mapper output', () => {
      // Fails to compile if PublicUserDto gains or loses a key without this
      // list (and so PUBLIC_USER_KEYS) being updated.
      const keys: Record<keyof PublicUserDto, true> = {
        avatarUrl: true,
        createdAt: true,
        displayName: true,
        id: true,
        roles: true,
        stellarAddress: true,
        username: true,
      };
      expect(Object.keys(keys).sort()).toEqual(PUBLIC_USER_KEYS);
    });

    it('asserts exact output keys of toPublicUser to prevent PII and entity leaks', () => {
      const mockUser = {
        id: 'usr_123',
        username: 'alice',
        displayName: 'Alice In Chains',
        avatarUrl: 'https://example.com/avatar.png',
        roles: ['CONTRIBUTOR'],
        stellarAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLBCIN32OWTACPOHXCDK23MZMXXMIHAAAA',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        email: 'alice@secret.com',
        githubAccount: {
          id: 'gh_1',
          accessToken: 'gho_secret_token',
          refreshToken: 'ghr_refresh_token',
        },
      } as unknown as User;

      const publicUser = toPublicUser(mockUser);
      const expectedKeys = [
        'avatarUrl',
        'createdAt',
        'displayName',
        'id',
        'roles',
        'stellarAddress',
        'username',
      ].sort();

      expect(Object.keys(publicUser).sort()).toEqual(expectedKeys);
    });

    it('asserts PublicUserDto structure matches the expected exact public keys', () => {
      const dto = new PublicUserDto();
      dto.id = 'usr_123';
      dto.username = 'alice';
      dto.displayName = 'Alice In Chains';
      dto.avatarUrl = 'https://example.com/avatar.png';
      dto.roles = [] as any;
      dto.stellarAddress = null;
      dto.createdAt = new Date();

      const expectedKeys = [
        'avatarUrl',
        'createdAt',
        'displayName',
        'id',
        'roles',
        'stellarAddress',
        'username',
      ].sort();

      expect(Object.keys(dto).sort()).toEqual(expectedKeys);
    });
  });
});
