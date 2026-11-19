import { User } from '../common/entities/user.entity';
import { toPublicUser } from './users.mapper';

describe('users.mapper', () => {
  describe('toPublicUser', () => {
    it('returns all public fields and excludes sensitive fields like email and githubAccount tokens', () => {
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

      // Verify public fields are present
      expect(publicUser).toEqual({
        id: 'usr_123',
        username: 'alice',
        displayName: 'Alice In Chains',
        avatarUrl: 'https://example.com/avatar.png',
        roles: ['CONTRIBUTOR'],
        stellarAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLBCIN32OWTACPOHXCDK23MZMXXMIHAAAA',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });

      // Assert sensitive fields are absent
      expect((publicUser as any).email).toBeUndefined();
      expect((publicUser as any).githubAccount).toBeUndefined();
      expect((publicUser as any).accessToken).toBeUndefined();
    });
  });
});
