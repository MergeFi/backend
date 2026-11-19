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
import type { Request } from 'express';
import request from 'supertest';
import { GithubStrategy } from '../strategies/github.strategy';
import { GithubAuthGuard } from './github-auth.guard';

const CLIENT_ID = 'guard-spec-client-id';
const CALLBACK_URL = 'http://localhost:4000/api/auth/github/callback';

/** Stands in for AuthController: records whether the guarded handler ran. */
const handlerCalls: unknown[] = [];

@Controller('auth')
class OAuthController {
  @Get('github')
  @UseGuards(GithubAuthGuard)
  login() {
    handlerCalls.push('login');
  }

  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  callback(@Req() req: Request) {
    handlerCalls.push(req.user);
    return { user: req.user };
  }
}

/** The pieces of passport-oauth2's internals the callback tests stub out. */
interface OAuth2Internals {
  _oauth2: {
    getOAuthAccessToken: (
      code: string,
      params: unknown,
      cb: (err: unknown, accessToken?: string, refreshToken?: string) => void,
    ) => void;
  };
  userProfile: (
    accessToken: string,
    done: (err: unknown, profile?: unknown) => void,
  ) => void;
}

/**
 * Exercises the real GithubAuthGuard + GithubStrategy over HTTP (#820).
 * github.strategy.spec.ts covers the strategy's validate(); this pins what
 * the guard lets through to AuthController.githubCallback (and therefore to
 * loginWithGithub) and what it stops.
 */
describe('GithubAuthGuard', () => {
  let app: INestApplication;
  let strategy: OAuth2Internals;
  let getOAuthAccessToken: jest.SpyInstance;
  let userProfile: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [OAuthController],
      providers: [
        GithubAuthGuard,
        GithubStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: () => ({
              clientId: CLIENT_ID,
              clientSecret: 'guard-spec-secret',
              oauthCallbackUrl: CALLBACK_URL,
            }),
          },
        },
      ],
    }).compile();

    strategy = moduleRef.get<GithubStrategy, OAuth2Internals>(GithubStrategy);
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    handlerCalls.length = 0;
    // Never reach github.com from a unit test.
    getOAuthAccessToken = jest
      .spyOn(strategy._oauth2, 'getOAuthAccessToken')
      .mockImplementation((_code, _params, cb) =>
        cb(new Error('token exchange should be stubbed per test')),
      );
    userProfile = jest
      .spyOn(strategy, 'userProfile')
      .mockImplementation((_token, done) =>
        done(new Error('userProfile should be stubbed per test')),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  function expectGithubAuthorizeRedirect(res: request.Response) {
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe(CALLBACK_URL);
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')).toBe('user:email,read:org');
  }

  describe('GET /auth/github (login)', () => {
    it('redirects to the GitHub authorize URL without running the handler', async () => {
      const res = await request(app.getHttpServer()).get('/auth/github');
      expectGithubAuthorizeRedirect(res);
      expect(handlerCalls).toHaveLength(0);
    });
  });

  describe('GET /auth/github/callback', () => {
    it('never reaches the handler when no code is supplied (bounces back to GitHub)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/auth/github/callback',
      );
      expectGithubAuthorizeRedirect(res);
      expect(getOAuthAccessToken).not.toHaveBeenCalled();
      expect(handlerCalls).toHaveLength(0);
    });

    it('returns 401 when the user denied access on GitHub', async () => {
      const res = await request(app.getHttpServer()).get(
        '/auth/github/callback?error=access_denied&error_description=denied',
      );
      expect(res.status).toBe(401);
      expect(getOAuthAccessToken).not.toHaveBeenCalled();
      expect(handlerCalls).toHaveLength(0);
    });

    it('does not reach the handler when GitHub rejects the code', async () => {
      const res = await request(app.getHttpServer()).get(
        '/auth/github/callback?code=forged-code',
      );
      // passport-oauth2 reports a failed token exchange as InternalOAuthError,
      // which is not an HttpException, so Nest answers 500. The handler (and
      // loginWithGithub) is still never reached, which is what matters here.
      expect(res.status).toBe(500);
      expect(getOAuthAccessToken).toHaveBeenCalledWith(
        'forged-code',
        expect.anything(),
        expect.any(Function),
      );
      expect(userProfile).not.toHaveBeenCalled();
      expect(handlerCalls).toHaveLength(0);
    });

    it('passes the mapped GitHub profile to the handler as req.user for a valid code', async () => {
      getOAuthAccessToken.mockImplementation((_code, _params, cb) =>
        cb(null, 'gh-access-token', 'gh-refresh-token'),
      );
      userProfile.mockImplementation((_token, done) =>
        done(null, {
          id: '42',
          username: 'octocat',
          emails: [{ value: 'octocat@example.com' }],
          photos: [{ value: 'https://avatars.example/42' }],
        }),
      );

      const res = await request(app.getHttpServer()).get(
        '/auth/github/callback?code=real-code',
      );

      expect(res.status).toBe(200);
      const expectedUser = {
        githubId: '42',
        username: 'octocat',
        email: 'octocat@example.com',
        avatarUrl: 'https://avatars.example/42',
        accessToken: 'gh-access-token',
        refreshToken: 'gh-refresh-token',
      };
      expect(res.body).toEqual({ user: expectedUser });
      expect(handlerCalls).toEqual([expectedUser]);
    });

    // Regression guard for the OAuth CSRF gap: once the strategy is
    // configured with `state: true` (plus session/state-store support), these
    // become real assertions that the guard refuses the callback.
    it.todo('refuses a callback whose state parameter is missing');
    it.todo('refuses a callback whose state does not match the issued one');
  });
});
