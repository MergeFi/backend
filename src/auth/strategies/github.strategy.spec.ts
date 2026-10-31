import { ConfigService } from '@nestjs/config';
import { GithubStrategy } from './github.strategy';
import { Profile } from 'passport-github2';

describe('GithubStrategy', () => {
  let strategy: GithubStrategy;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockReturnValue({
        clientId: 'test_client_id',
        clientSecret: 'test_client_secret',
        oauthCallbackUrl: 'http://localhost:3000/api/auth/github/callback',
      }),
    } as unknown as jest.Mocked<ConfigService>;

    strategy = new GithubStrategy(mockConfigService);
  });

  it('validates and maps profile correctly when all fields are present', (done) => {
    const mockProfile: Profile = {
      id: '123456',
      username: 'octocat',
      displayName: 'The Octocat',
      profileUrl: 'https://github.com/octocat',
      provider: 'github',
      emails: [{ value: 'octocat@github.com' }],
      photos: [{ value: 'https://avatars.githubusercontent.com/u/123456' }],
      _raw: '',
      _json: {} as any,
    };

    strategy.validate(
      'mock_access_token',
      'mock_refresh_token',
      mockProfile,
      (err, user) => {
        expect(err).toBeNull();
        expect(user).toEqual({
          githubId: '123456',
          username: 'octocat',
          email: 'octocat@github.com',
          avatarUrl: 'https://avatars.githubusercontent.com/u/123456',
          accessToken: 'mock_access_token',
          refreshToken: 'mock_refresh_token',
        });
        done();
      },
    );
  });

  it('handles profile with no public email and missing avatar', (done) => {
    const mockProfile: Profile = {
      id: '78910',
      username: 'privateuser',
      displayName: 'Private User',
      profileUrl: 'https://github.com/privateuser',
      provider: 'github',
      emails: undefined,
      photos: undefined,
      _raw: '',
      _json: {} as any,
    };

    strategy.validate(
      'token_1',
      'token_2',
      mockProfile,
      (err, user) => {
        expect(err).toBeNull();
        expect(user).toEqual({
          githubId: '78910',
          username: 'privateuser',
          email: null,
          avatarUrl: null,
          accessToken: 'token_1',
          refreshToken: 'token_2',
        });
        done();
      },
    );
  });

  it('stringifies numeric githubId if provided as a number', (done) => {
    const mockProfile = {
      id: 99999 as unknown as string,
      username: 'numberid',
      emails: [],
      photos: [],
    } as unknown as Profile;

    strategy.validate(
      'tok_a',
      'tok_b',
      mockProfile,
      (err, user) => {
        expect(err).toBeNull();
        expect(user.githubId).toBe(99999); // or String(id)
        done();
      },
    );
  });
});
