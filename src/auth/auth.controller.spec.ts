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

describe('AuthController githubCallback cookie secure flag (#614)', () => {
  let controller: AuthController;
  let authService: AuthService;
  let configService: jest.Mocked<ConfigService<AppConfig, true>>;
  let mockRes: { cookie: jest.Mock; redirect: jest.Mock };

  beforeEach(() => {
    authService = {
      loginWithGithub: jest.fn().mockResolvedValue({ accessToken: 'mock-jwt' }),
      createHandoffCode: jest.fn().mockReturnValue('handoff-123'),
    } as unknown as AuthService;

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'frontendUrl') return 'http://localhost:3001';
        if (key === 'env') return 'development';
        if (key === 'appUrl') return 'http://localhost:3000';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService<AppConfig, true>>;

    controller = new AuthController(authService, configService);

    mockRes = {
      cookie: jest.fn(),
      redirect: jest.fn(),
    };
  });

  it('sets secure: true when req.secure is true outside production (e.g. HTTPS staging)', async () => {
    const req = {
      user: { githubId: '123', login: 'testuser' },
      secure: true,
    } as any;

    await controller.githubCallback(req, mockRes as any);

    expect(mockRes.cookie).toHaveBeenCalledWith(
      'access_token',
      'mock-jwt',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      }),
    );
  });

  it('sets secure: true when APP_URL starts with https://', async () => {
    configService.get.mockImplementation(((key: string) => {
      if (key === 'frontendUrl') return 'https://mergefi.org';
      if (key === 'env') return 'staging';
      if (key === 'appUrl') return 'https://api-staging.mergefi.org';
      return undefined;
    }) as any);

    const req = {
      user: { githubId: '123', login: 'testuser' },
      secure: false,
    } as any;

    await controller.githubCallback(req, mockRes as any);

    expect(mockRes.cookie).toHaveBeenCalledWith(
      'access_token',
      'mock-jwt',
      expect.objectContaining({ secure: true }),
    );
  });

  it('sets secure: true in production environment', async () => {
    configService.get.mockImplementation(((key: string) => {
      if (key === 'frontendUrl') return 'https://mergefi.org';
      if (key === 'env') return 'production';
      if (key === 'appUrl') return 'http://internal-cluster';
      return undefined;
    }) as any);

    const req = {
      user: { githubId: '123', login: 'testuser' },
      secure: false,
    } as any;

    await controller.githubCallback(req, mockRes as any);

    expect(mockRes.cookie).toHaveBeenCalledWith(
      'access_token',
      'mock-jwt',
      expect.objectContaining({ secure: true }),
    );
  });

  it('leaves secure: false on plain HTTP local development', async () => {
    const req = {
      user: { githubId: '123', login: 'testuser' },
      secure: false,
    } as any;

    await controller.githubCallback(req, mockRes as any);

    expect(mockRes.cookie).toHaveBeenCalledWith(
      'access_token',
      'mock-jwt',
      expect.objectContaining({ secure: false }),
    );
  });
});
