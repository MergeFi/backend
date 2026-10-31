import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ExtractJwt } from 'passport-jwt';
import { Request } from 'express';
import { JwtStrategy, cookieExtractor } from './jwt.strategy';
import { UsersService } from '../../users/users.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: { findOneRaw: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    usersService = {
      findOneRaw: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };
    configService = {
      get: jest.fn().mockReturnValue({ secret: 'test-secret' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
  });

  describe('cookieExtractor', () => {
    it('returns token from req.cookies if populated', () => {
      const req = {
        cookies: { access_token: 'cookie-token' },
      } as unknown as Request;
      expect(cookieExtractor(req)).toBe('cookie-token');
    });

    it('extracts token from cookie header when req.cookies is not available', () => {
      const req = {
        headers: { cookie: 'other=val; access_token=header-cookie-token' },
      } as unknown as Request;
      expect(cookieExtractor(req)).toBe('header-cookie-token');
    });

    it('returns null on malformed encoded cookie value', () => {
      const req = {
        headers: { cookie: 'access_token=%invalid' },
      } as unknown as Request;
      expect(cookieExtractor(req)).toBeNull();
    });

    it('returns null if no cookie header or access_token present', () => {
      const req = { headers: {} } as unknown as Request;
      expect(cookieExtractor(req)).toBeNull();
    });
  });

  describe('bearer vs cookie precedence', () => {
    it('prefers Bearer token in Authorization header over cookie', () => {
      const extractor = ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor,
      ]);

      const reqWithBoth = {
        headers: {
          authorization: 'Bearer bearer-token-123',
          cookie: 'access_token=cookie-token-456',
        },
      } as unknown as Request;

      expect(extractor(reqWithBoth)).toBe('bearer-token-123');

      const reqWithCookieOnly = {
        headers: {
          cookie: 'access_token=cookie-token-456',
        },
      } as unknown as Request;

      expect(extractor(reqWithCookieOnly)).toBe('cookie-token-456');
    });
  });

  describe('validate', () => {
    it('returns userId and username for valid payload', async () => {
      const result = await strategy.validate({
        sub: 'user-1',
        username: 'alice',
      });
      expect(result).toEqual({ userId: 'user-1', username: 'alice' });
      expect(usersService.findOneRaw).toHaveBeenCalledWith('user-1');
    });

    it('throws UnauthorizedException when sub is missing', async () => {
      await expect(
        strategy.validate({ sub: '', username: 'alice' } as any),
      ).rejects.toThrow(new UnauthorizedException('Invalid token payload'));
    });

    it('throws 401 UnauthorizedException when user no longer exists', async () => {
      usersService.findOneRaw.mockRejectedValue(new Error('User not found'));
      await expect(
        strategy.validate({ sub: 'deleted-user', username: 'alice' }),
      ).rejects.toThrow(new UnauthorizedException('User no longer exists'));
    });
  });
});
