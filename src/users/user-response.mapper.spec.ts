import { toPublicUser } from './user-response.mapper';
import { User, GithubAccount } from '../common/entities';
import { UserRole } from '../common/enums';

function makeTestUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-uuid-1';
  user.username = 'alice';
  user.email = 'alice@example.com';
  user.displayName = 'Alice Developer';
  user.avatarUrl = 'https://avatars.githubusercontent.com/u/123';
  user.roles = [UserRole.CONTRIBUTOR];
  user.stellarAddress = 'GA2C5RFPE6GCKMY3Z4AWSDVOMLCUCPW7S55QHGQ7G6EGE2TRD4F4QG';
  user.createdAt = new Date('2026-01-01T00:00:00Z');
  user.updatedAt = new Date('2026-01-02T00:00:00Z');
  user.githubAccount = null;
  return Object.assign(user, overrides);
}

describe('UserResponseMapper (toPublicUser)', () => {
  it('strips email for an unauthenticated or unrelated user request', () => {
    const user = makeTestUser();
    const result = toPublicUser(user, {
      currentUser: { userId: 'different-user-id', roles: [UserRole.CONTRIBUTOR] },
    });

    expect(result).not.toHaveProperty('email');
    expect(result.id).toBe('user-uuid-1');
    expect(result.username).toBe('alice');
    expect(result.displayName).toBe('Alice Developer');
    expect(result.stellarAddress).toBe('GA2C5RFPE6GCKMY3Z4AWSDVOMLCUCPW7S55QHGQ7G6EGE2TRD4F4QG');
  });

  it('strips email when no currentUser is provided', () => {
    const user = makeTestUser();
    const result = toPublicUser(user);

    expect(result).not.toHaveProperty('email');
    expect(result.username).toBe('alice');
  });

  it('includes email when caller is the owner (same userId)', () => {
    const user = makeTestUser();
    const result = toPublicUser(user, {
      currentUser: { userId: 'user-uuid-1', roles: [UserRole.CONTRIBUTOR] },
    });

    expect(result.email).toBe('alice@example.com');
  });

  it('includes email when caller is an admin or maintainer', () => {
    const user = makeTestUser();
    const result = toPublicUser(user, {
      currentUser: { userId: 'admin-user-id', roles: ['admin'] },
    });

    expect(result.email).toBe('alice@example.com');

    const resultMaintainer = toPublicUser(user, {
      currentUser: { userId: 'm-user-id', roles: [UserRole.MAINTAINER] },
    });

    expect(resultMaintainer.email).toBe('alice@example.com');
  });

  it('safely serializes githubAccount relation without sensitive token properties', () => {
    const account = new GithubAccount();
    account.id = 'gh-acc-1';
    account.githubId = '12345';
    account.login = 'alice';
    account.profileUrl = 'https://github.com/alice';
    account.avatarUrl = 'https://avatars.githubusercontent.com/u/123';
    account.accessToken = 'gho_secret_token_12345';
    account.refreshToken = 'ghr_refresh_token_12345';
    account.createdAt = new Date('2026-01-01T00:00:00Z');
    account.updatedAt = new Date('2026-01-02T00:00:00Z');

    const user = makeTestUser({ githubAccount: account });
    const result = toPublicUser(user);

    expect(result.githubAccount).toBeDefined();
    expect(result.githubAccount?.login).toBe('alice');
    expect(result.githubAccount).not.toHaveProperty('accessToken');
    expect(result.githubAccount).not.toHaveProperty('refreshToken');
  });
});
