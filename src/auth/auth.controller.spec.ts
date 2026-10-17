import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AppConfig } from '../config/configuration';

describe('AuthController handoff exchange logging (#366)', () => {
  let controller: AuthController;
  let consumeHandoffCode: jest.Mock;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    consumeHandoffCode = jest.fn();
    controller = new AuthController(
      { consumeHandoffCode } as unknown as AuthService,
      {} as ConfigService<AppConfig, true>,
    );
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['exchangeHandoff', '/auth/handoff'],
    ['exchangeHandoffAlias', '/auth/exchange'],
  ] as const)(
    '%s warns on an invalid or expired code without logging it',
    (method, route) => {
      consumeHandoffCode.mockReturnValue(null);

      expect(() =>
        controller[method]('leaked-code-123', '203.0.113.9'),
      ).toThrow(UnauthorizedException);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const line = warnSpy.mock.calls[0][0] as string;
      expect(line).toContain(route);
      expect(line).toContain('203.0.113.9');
      expect(line).toContain('invalid or expired');
      expect(line).not.toContain('leaked-code-123');
    },
  );

  it('warns on a missing code', () => {
    expect(() => controller.exchangeHandoff('', '203.0.113.9')).toThrow(
      'Missing handoff code',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing code'),
    );
    expect(consumeHandoffCode).not.toHaveBeenCalled();
  });

  it('returns the token and does not warn on a valid code', () => {
    consumeHandoffCode.mockReturnValue('jwt');

    expect(controller.exchangeHandoffAlias('good', '203.0.113.9')).toEqual({
      accessToken: 'jwt',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('AuthController githubCallback cookie security (#614)', () => {
  let controller: AuthController;
  let loginWithGithub: jest.Mock;
  let createHandoffCode: jest.Mock;
  let configServiceGet: jest.Mock;

  beforeEach(() => {
    loginWithGithub = jest
      .fn()
      .mockResolvedValue({ accessToken: 'jwt-token-xyz' });
    createHandoffCode = jest.fn().mockReturnValue('handoff-code-123');
    configServiceGet = jest.fn((key: string) => {
      if (key === 'frontendUrl') return 'https://staging.mergefi.xyz';
      if (key === 'env') return 'staging';
      if (key === 'appUrl') return 'https://api-staging.mergefi.xyz';
      return undefined;
    });

    const mockAuthService = {
      loginWithGithub,
      createHandoffCode,
    } as unknown as AuthService;

    const mockConfigService = {
      get: configServiceGet,
    } as unknown as ConfigService<AppConfig, true>;

    controller = new AuthController(mockAuthService, mockConfigService);
  });

  it('sets secure: true on HTTPS staging/preview deployments via req.secure', async () => {
    const req = {
      user: { githubId: '123', login: 'alice' },
      secure: true,
      protocol: 'https',
    } as unknown as Request;

    const cookieMock = jest.fn();
    const redirectMock = jest.fn();
    const res = {
      cookie: cookieMock,
      redirect: redirectMock,
    } as unknown as Response;

    await controller.githubCallback(req, res);

    expect(cookieMock).toHaveBeenCalledWith(
      'access_token',
      'jwt-token-xyz',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      }),
    );
    expect(redirectMock).toHaveBeenCalledWith(
      'https://staging.mergefi.xyz/auth/callback?code=handoff-code-123',
    );
  });

  it('sets secure: true when appUrl begins with https even if req.secure is false', async () => {
    const req = {
      user: { githubId: '123', login: 'alice' },
      secure: false,
      protocol: 'http',
    } as unknown as Request;

    const cookieMock = jest.fn();
    const res = {
      cookie: cookieMock,
      redirect: jest.fn(),
    } as unknown as Response;

    await controller.githubCallback(req, res);

    expect(cookieMock).toHaveBeenCalledWith(
      'access_token',
      'jwt-token-xyz',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
      }),
    );
  });

  it('sets secure: true unconditionally in production', async () => {
    configServiceGet.mockImplementation((key: string) => {
      if (key === 'env') return 'production';
      if (key === 'appUrl') return 'http://internal-ingress';
      if (key === 'frontendUrl') return 'https://mergefi.xyz';
      return undefined;
    });

    const req = {
      user: { githubId: '123', login: 'alice' },
      secure: false,
      protocol: 'http',
    } as unknown as Request;

    const cookieMock = jest.fn();
    const res = {
      cookie: cookieMock,
      redirect: jest.fn(),
    } as unknown as Response;

    await controller.githubCallback(req, res);

    expect(cookieMock).toHaveBeenCalledWith(
      'access_token',
      'jwt-token-xyz',
      expect.objectContaining({
        secure: true,
      }),
    );
  });

  it('allows secure: false only on plain http local development', async () => {
    configServiceGet.mockImplementation((key: string) => {
      if (key === 'env') return 'development';
      if (key === 'appUrl') return 'http://localhost:3000';
      if (key === 'frontendUrl') return 'http://localhost:3001';
      return undefined;
    });

    const req = {
      user: { githubId: '123', login: 'alice' },
      secure: false,
      protocol: 'http',
    } as unknown as Request;

    const cookieMock = jest.fn();
    const res = {
      cookie: cookieMock,
      redirect: jest.fn(),
    } as unknown as Response;

    await controller.githubCallback(req, res);

    expect(cookieMock).toHaveBeenCalledWith(
      'access_token',
      'jwt-token-xyz',
      expect.objectContaining({
        secure: false,
      }),
    );
  });
});
