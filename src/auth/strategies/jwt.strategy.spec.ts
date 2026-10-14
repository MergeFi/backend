import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { cookieExtractor, JwtStrategy } from './jwt.strategy';

function reqWithCookie(header?: string): Request {
  return { headers: header ? { cookie: header } : {} } as unknown as Request;
}

describe('cookieExtractor (#593)', () => {
  it('returns the access_token cookie value', () => {
    const req = reqWithCookie('access_token=abc123; other=x');
    expect(cookieExtractor(req)).toBe('abc123');
  });

  it('prefers req.cookies when populated', () => {
    const req = {
      cookies: { access_token: 'from-cookies' },
    } as unknown as Request;
    expect(cookieExtractor(req)).toBe('from-cookies');
  });

  it('decodes a URI-encoded token', () => {
    const req = reqWithCookie('access_token=abc%2Fdef');
    expect(cookieExtractor(req)).toBe('abc/def');
  });

  it('returns null for a malformed (un-decodable) token', () => {
    const req = reqWithCookie('access_token=%E0%A4%A'); // invalid UTF-8 escape
    expect(cookieExtractor(req)).toBeNull();
  });

  it('returns null when no cookie header or request', () => {
    expect(cookieExtractor(reqWithCookie())).toBeNull();
    expect(cookieExtractor(null as unknown as Request)).toBeNull();
  });
});

describe('JwtStrategy.validate (#593)', () => {
  const usersService = { findOneRaw: jest.fn() };
  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(
      { get: () => ({ secret: 'test' }) } as never,
      usersService as never,
    );
  });

  it('rejects a payload with no sub', async () => {
    await expect(
      strategy.validate({ sub: '', username: 'x' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose user no longer exists', async () => {
    usersService.findOneRaw.mockRejectedValue(new Error('not found'));
    await expect(
      strategy.validate({ sub: 'u1', username: 'x' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns the identity for a valid token', async () => {
    usersService.findOneRaw.mockResolvedValue({ id: 'u1' });
    await expect(
      strategy.validate({ sub: 'u1', username: 'alice' }),
    ).resolves.toEqual({ userId: 'u1', username: 'alice' });
  });
});
