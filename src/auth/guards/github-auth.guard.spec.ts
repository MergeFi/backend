import {
  Controller,
  Get,
  INestApplication,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { GithubStrategy } from '../strategies/github.strategy';
import { GithubAuthGuard } from './github-auth.guard';

const CALLBACK_URL = 'http://localhost:4000/api/auth/github/callback';

const handlerSpy = jest.fn();

/** Stand-in for AuthController's two GitHub routes. */
@Controller('auth')
class OAuthController {
  @Get('github')
  @UseGuards(GithubAuthGuard)
  githubLogin() {
    handlerSpy('login');
  }

  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  githubCallback(@Req() req: Request) {
    handlerSpy('callback', req.user);
    return req.user;
  }
}

type TokenCallback = (
  err: { statusCode: number; data?: string } | null,
  accessToken?: string,
  refreshToken?: string,
  params?: Record<string, unknown>,
) => void;

/** The parts of passport-oauth2's internals stubbed to avoid network calls. */
interface StubbableStrategy {
  _oauth2: {
    getOAuthAccessToken: (
      code: string,
      params: Record<string, unknown>,
      cb: TokenCallback,
    ) => void;
  };
  userProfile: (
    accessToken: string,
    done: (err: Error | null, profile?: unknown) => void,
  ) => void;
}

/**
 * Exercises GithubAuthGuard end-to-end through the real GithubStrategy, with
 * only the GitHub token exchange and profile fetch stubbed (#820). This guard
 * is the only thing between an arbitrary `?code=` and loginWithGithub.
 */
describe('GithubAuthGuard', () => {
  let app: INestApplication<App>;
  let strategy: StubbableStrategy;
  let exchangeCode: jest.Mock;
  let fetchProfile: jest.Mock;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [OAuthController],
      providers: [
        GithubStrategy,
        GithubAuthGuard,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              clientId: 'test-client-id',
              clientSecret: 'test-client-secret',
              oauthCallbackUrl: CALLBACK_URL,
            }),
          },
        },
      ],
    }).compile();

    strategy = moduleRef.get<StubbableStrategy>(GithubStrategy);
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  beforeEach(() => {
    handlerSpy.mockReset();
    exchangeCode = jest.fn((_code: string, _params, cb: TokenCallback) =>
      cb(null, 'gh-access-token', 'gh-refresh-token', {}),
    );
    fetchProfile = jest.fn(
      (_token: string, done: (err: Error | null, profile?: unknown) => void) =>
        done(null, {
          id: '4242',
          username: 'octocat',
          emails: [{ value: 'octo@example.com' }],
          photos: [{ value: 'https://avatars.example/octo.png' }],
        }),
    );
    strategy._oauth2.getOAuthAccessToken = exchangeCode;
    strategy.userProfile = fetchProfile;
  });

  afterAll(async () => {
    await app.close();
  });

  function expectAuthorizeRedirect(res: request.Response) {
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(CALLBACK_URL);
    expect(location.searchParams.get('scope')).toBe('user:email,read:org');
    expect(location.searchParams.get('response_type')).toBe('code');
  }

  describe('GET /auth/github (login)', () => {
    it('redirects to GitHub authorize without running the handler', async () => {
      const res = await request(app.getHttpServer()).get('/auth/github');

      expectAuthorizeRedirect(res);
      expect(handlerSpy).not.toHaveBeenCalled();
      expect(exchangeCode).not.toHaveBeenCalled();
    });
  });

  describe('GET /auth/github/callback', () => {
    it('never reaches the handler without a code (restarts the OAuth flow)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/auth/github/callback',
      );

      expectAuthorizeRedirect(res);
      expect(handlerSpy).not.toHaveBeenCalled();
      expect(exchangeCode).not.toHaveBeenCalled();
    });

    it('rejects with 401 when GitHub reports the user denied access', async () => {
      const res = await request(app.getHttpServer()).get(
        '/auth/github/callback?error=access_denied&error_description=denied',
      );

      expect(res.status).toBe(401);
      expect(handlerSpy).not.toHaveBeenCalled();
      expect(exchangeCode).not.toHaveBeenCalled();
    });

    it('does not reach the handler when the code exchange fails', async () => {
      exchangeCode.mockImplementation(
        (_code: string, _params, cb: TokenCallback) =>
          cb({ statusCode: 401, data: '{"error":"bad_verification_code"}' }),
      );

      const res = await request(app.getHttpServer()).get(
        '/auth/github/callback?code=forged',
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(exchangeCode).toHaveBeenCalledWith(
        'forged',
        expect.anything(),
        expect.any(Function),
      );
      expect(fetchProfile).not.toHaveBeenCalled();
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('does not reach the handler when the profile fetch fails', async () => {
      fetchProfile.mockImplementation(
        (_token: string, done: (err: Error | null) => void) =>
          done(new Error('profile fetch failed')),
      );

      const res = await request(app.getHttpServer()).get(
        '/auth/github/callback?code=good',
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('exchanges a valid code and hands the mapped profile to the handler', async () => {
      const res = await request(app.getHttpServer()).get(
        '/auth/github/callback?code=good',
      );

      const expectedUser = {
        githubId: '4242',
        username: 'octocat',
        email: 'octo@example.com',
        avatarUrl: 'https://avatars.example/octo.png',
        accessToken: 'gh-access-token',
        refreshToken: 'gh-refresh-token',
      };
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expectedUser);
      expect(exchangeCode).toHaveBeenCalledWith(
        'good',
        expect.objectContaining({ redirect_uri: CALLBACK_URL }),
        expect.any(Function),
      );
      expect(handlerSpy).toHaveBeenCalledWith('callback', expectedUser);
    });

    // Regression guard for the OAuth CSRF fix: once GithubStrategy is
    // configured with `state: true`, a callback whose `state` is missing or
    // does not match the one issued on /auth/github must be refused before
    // the code is exchanged.
    it.todo('rejects a callback with a missing state once state: true is set');
    it.todo(
      'rejects a callback with a mismatched state once state: true is set',
    );
  });
});
