import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Profile } from 'passport-github2';
import { VerifyCallback } from 'passport-oauth2';
import { GithubStrategy } from './github.strategy';

describe('GithubStrategy (#594, #133, #286)', () => {
  let strategy: GithubStrategy;
  let configService: {
    get: jest.Mock;
  };

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'github') {
          return {
            clientId: 'custom_client_id',
            clientSecret: 'custom_client_secret',
            oauthCallbackUrl:
              'https://api.mergefi.org/api/auth/github/callback',
          };
        }
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubStrategy,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    strategy = module.get<GithubStrategy>(GithubStrategy);
  });

  describe('constructor configuration', () => {
    it('instantiates with custom config from ConfigService', () => {
      expect(strategy).toBeDefined();
    });

    it('falls back gracefully to default client/secret/callback when config is absent', async () => {
      const emptyConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GithubStrategy,
          { provide: ConfigService, useValue: emptyConfigService },
        ],
      }).compile();

      const fallbackStrategy = module.get<GithubStrategy>(GithubStrategy);
      expect(fallbackStrategy).toBeDefined();
    });
  });

  describe('validate method — profile mapping to UpsertFromGithubInput (#594)', () => {
    const accessToken = 'gho_dummy_access_token_123';
    const refreshToken = 'ghr_dummy_refresh_token_456';

    it('maps a full profile with email and avatar correctly', () => {
      const profile = {
        id: '583231',
        username: 'octocat',
        displayName: 'The Octocat',
        profileUrl: 'https://github.com/octocat',
        emails: [{ value: 'octocat@github.com' }],
        photos: [{ value: 'https://avatars.githubusercontent.com/u/583231' }],
      } as unknown as Profile;

      const done: VerifyCallback = jest.fn();

      strategy.validate(accessToken, refreshToken, profile, done);

      expect(done).toHaveBeenCalledTimes(1);
      expect(done).toHaveBeenCalledWith(null, {
        githubId: '583231',
        login: 'octocat',
        username: 'octocat',
        email: 'octocat@github.com',
        avatarUrl: 'https://avatars.githubusercontent.com/u/583231',
        accessToken,
        refreshToken,
      });
    });

    it('stringifies numeric githubId correctly', () => {
      const profile = {
        id: 12345678,
        username: 'numeric_user',
        emails: [{ value: 'numeric@example.com' }],
        photos: [{ value: 'https://example.com/avatar.png' }],
      } as unknown as Profile;

      const done: VerifyCallback = jest.fn();

      strategy.validate(accessToken, refreshToken, profile, done);

      expect(done).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          githubId: '12345678',
        }),
      );
    });

    it('sets email to null when emails array is missing or empty', () => {
      const profileNoEmails = {
        id: '12345',
        username: 'private_email_user',
        photos: [{ value: 'https://example.com/avatar.png' }],
      } as unknown as Profile;

      const done: VerifyCallback = jest.fn();

      strategy.validate(accessToken, refreshToken, profileNoEmails, done);

      expect(done).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          githubId: '12345',
          email: null,
          avatarUrl: 'https://example.com/avatar.png',
        }),
      );

      const profileEmptyEmails = {
        id: '12345',
        username: 'private_email_user',
        emails: [],
        photos: [{ value: 'https://example.com/avatar.png' }],
      } as unknown as Profile;

      const done2: VerifyCallback = jest.fn();
      strategy.validate(accessToken, refreshToken, profileEmptyEmails, done2);

      expect(done2).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          email: null,
        }),
      );
    });

    it('sets avatarUrl to null when photos array is missing or empty', () => {
      const profileNoPhotos = {
        id: '67890',
        username: 'no_avatar_user',
        emails: [{ value: 'noavatar@example.com' }],
      } as unknown as Profile;

      const done: VerifyCallback = jest.fn();

      strategy.validate(accessToken, refreshToken, profileNoPhotos, done);

      expect(done).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          githubId: '67890',
          avatarUrl: null,
          email: 'noavatar@example.com',
        }),
      );

      const profileEmptyPhotos = {
        id: '67890',
        username: 'no_avatar_user',
        emails: [{ value: 'noavatar@example.com' }],
        photos: [],
      } as unknown as Profile;

      const done2: VerifyCallback = jest.fn();
      strategy.validate(accessToken, refreshToken, profileEmptyPhotos, done2);

      expect(done2).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          avatarUrl: null,
        }),
      );
    });

    it('handles falsy or empty email/photo values by falling back to null', () => {
      const profileWithEmptyValues = {
        id: '99999',
        username: 'empty_values_user',
        emails: [{ value: '' }],
        photos: [{ value: '' }],
      } as unknown as Profile;

      const done: VerifyCallback = jest.fn();

      strategy.validate(
        accessToken,
        refreshToken,
        profileWithEmptyValues,
        done,
      );

      expect(done).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          githubId: '99999',
          email: null,
          avatarUrl: null,
        }),
      );
    });
  });
});
