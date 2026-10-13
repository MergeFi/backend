import { toPublicUser } from './users.mapper';
import { User } from '../common/entities/user.entity';
import { UserRole } from '../common/enums';

describe('toPublicUser', () => {
  const baseDate = new Date('2026-01-01T12:00:00.000Z');
  const updatedDate = new Date('2026-01-02T15:30:00.000Z');

  it('maps all expected public fields from a full User entity', () => {
    const user: User = {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      username: 'alice_contributor',
      displayName: 'Alice Contributor',
      avatarUrl: 'https://example.com/avatar.png',
      roles: [UserRole.CONTRIBUTOR],
      stellarAddress:
        'GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BC8MRF2A27V5PU',
      createdAt: baseDate,
      email: 'alice@private-domain.internal',
      updatedAt: updatedDate,
      githubAccount: {
        id: 42,
        login: 'alice-gh',
        githubId: '987654',
        avatarUrl: 'https://github.com/avatar.png',
        profileUrl: 'https://github.com/alice-gh',
        userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        accessToken: 'gho_secretAccessTokenThatMustNeverLeak12345',
        refreshToken: 'ghr_secretRefreshTokenThatMustNeverLeak67890',
        user: null as unknown as User,
      },
    };

    const publicUser = toPublicUser(user);

    expect(publicUser).toEqual({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      username: 'alice_contributor',
      displayName: 'Alice Contributor',
      avatarUrl: 'https://example.com/avatar.png',
      roles: [UserRole.CONTRIBUTOR],
      stellarAddress:
        'GA2C5RFPE6GCKMY3US5PAB6UZLKIGSPIUKSLRB6ZN7BC8MRF2A27V5PU',
      createdAt: baseDate,
    });
  });

  it('never leaks private email, githubAccount, or tokens (#359)', () => {
    const user: User = {
      id: 'b1ffcd88-8b1a-4fe7-aa5c-5aa8ac270b22',
      username: 'bob_sponsor',
      displayName: 'Bob Sponsor',
      avatarUrl: null,
      roles: [UserRole.SPONSOR],
      stellarAddress: null,
      createdAt: baseDate,
      email: 'confidential_sponsor@company.com',
      updatedAt: updatedDate,
      githubAccount: {
        id: 99,
        login: 'bob-corp',
        githubId: '112233',
        avatarUrl: null,
        profileUrl: 'https://github.com/bob-corp',
        userId: 'b1ffcd88-8b1a-4fe7-aa5c-5aa8ac270b22',
        accessToken: 'ghp_superSensitiveTokenValue',
        refreshToken: 'ghr_superSensitiveRefreshTokenValue',
        user: null as unknown as User,
      },
    };

    const publicUser = toPublicUser(user);
    const publicUserRecord = publicUser as unknown as Record<string, unknown>;

    // Sensitive user fields must not exist on the returned DTO
    expect(publicUserRecord.email).toBeUndefined();
    expect(publicUserRecord.githubAccount).toBeUndefined();
    expect(publicUserRecord.updatedAt).toBeUndefined();
    expect('email' in publicUserRecord).toBe(false);
    expect('githubAccount' in publicUserRecord).toBe(false);
    expect('updatedAt' in publicUserRecord).toBe(false);
    expect('accessToken' in publicUserRecord).toBe(false);
    expect('refreshToken' in publicUserRecord).toBe(false);

    // Exactly the 7 allowed public properties must be present
    const allowedKeys = [
      'avatarUrl',
      'createdAt',
      'displayName',
      'id',
      'roles',
      'stellarAddress',
      'username',
    ];
    expect(Object.keys(publicUser).sort()).toEqual(allowedKeys);
  });

  it('handles null values for optional public fields correctly', () => {
    const user: User = {
      id: 'c2eedd77-7a2b-4cd6-994b-4bb7ab160c33',
      username: 'minimal_user',
      displayName: null,
      avatarUrl: null,
      roles: [UserRole.CONTRIBUTOR],
      stellarAddress: null,
      createdAt: baseDate,
      email: null,
      updatedAt: updatedDate,
      githubAccount: null,
    };

    const publicUser = toPublicUser(user);

    expect(publicUser).toEqual({
      id: 'c2eedd77-7a2b-4cd6-994b-4bb7ab160c33',
      username: 'minimal_user',
      displayName: null,
      avatarUrl: null,
      roles: [UserRole.CONTRIBUTOR],
      stellarAddress: null,
      createdAt: baseDate,
    });
  });

  it('handles multiple roles on a single user entity', () => {
    const user: User = {
      id: 'd3ffee66-6b3c-4bc5-883a-3aa6ba050d44',
      username: 'maintainer_user',
      displayName: 'Core Maintainer',
      avatarUrl: 'https://example.com/maintainer.jpg',
      roles: [UserRole.CONTRIBUTOR, UserRole.MAINTAINER, UserRole.SPONSOR],
      stellarAddress:
        'GBBD67IFCTOQCPTN6R77L6TNO4QO4CQCBC25E73KPB2HDOAXVKOY7B5K',
      createdAt: baseDate,
      email: 'maintainer@mergefi.org',
      updatedAt: updatedDate,
      githubAccount: null,
    };

    const publicUser = toPublicUser(user);

    expect(publicUser.roles).toEqual([
      UserRole.CONTRIBUTOR,
      UserRole.MAINTAINER,
      UserRole.SPONSOR,
    ]);
  });
});
