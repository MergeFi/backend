import {
  ArgumentsHost,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

// The OAuth callback and handoff routes carry single-use codes in the query
// string. Nothing the filter logs may contain them (#804).
const SECRET_CODE = 'gh-oauth-code-SECRET123';

function hostFor(url: string) {
  const json = jest.fn();
  const response = { status: jest.fn(() => ({ json })), json };
  const request = { method: 'GET', url, originalUrl: url, path: url.split('?')[0] };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return host;
}

describe('GlobalExceptionFilter query-string redaction (#804)', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('does not log the query string when an unexpected error hits the callback', () => {
    const url = `/auth/github/callback?code=${SECRET_CODE}&state=abc`;
    new GlobalExceptionFilter().catch(new Error('db down'), hostFor(url));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = errorSpy.mock.calls[0][0] as string;
    expect(line).toContain('/auth/github/callback');
    expect(line).not.toContain(SECRET_CODE);
    expect(line).not.toContain('state=');
  });

  it('does not log the query string for a client error on the handoff route', () => {
    const url = `/auth/handoff?code=${SECRET_CODE}`;
    new GlobalExceptionFilter().catch(
      new BadRequestException('bad'),
      hostFor(url),
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = warnSpy.mock.calls[0][0] as string;
    expect(line).toContain('/auth/handoff');
    expect(line).not.toContain(SECRET_CODE);
  });
});
