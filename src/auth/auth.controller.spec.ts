import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AppConfig } from '../config/configuration';

// Single handler for both paths (#807): the request's path decides which
// route name is logged.
const requestFor = (path: string) => ({ path }) as unknown as Request;

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

  it.each(['/auth/handoff', '/auth/exchange'])(
    'warns on an invalid or expired code on %s without logging it',
    (route) => {
      consumeHandoffCode.mockReturnValue(null);

      expect(() =>
        controller.exchangeHandoff(
          'leaked-code-123',
          '203.0.113.9',
          requestFor(route),
        ),
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
    expect(() =>
      controller.exchangeHandoff('', '203.0.113.9', requestFor('/auth/handoff')),
    ).toThrow('Missing handoff code');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing code'),
    );
    expect(consumeHandoffCode).not.toHaveBeenCalled();
  });

  it('returns the token and does not warn on a valid code', () => {
    consumeHandoffCode.mockReturnValue('jwt');

    expect(
      controller.exchangeHandoff('good', '203.0.113.9', requestFor('/auth/exchange')),
    ).toEqual({ accessToken: 'jwt' });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
