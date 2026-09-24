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
