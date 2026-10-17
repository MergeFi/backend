import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ExtractJwt } from 'passport-jwt';
import { Request } from 'express';
import { cookieExtractor, JwtPayload, JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';

describe('JwtStrategy & cookieExtractor (#593, #462, #286)', () => {
  let strategy: JwtStrategy;
  let usersService: {
    findOneRaw: jest.Mock;
  };
  let configService: {
    get: jest.Mock;
  };

  beforeEach(async () => {
    usersService = {
      findOneRaw: jest.fn(),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'jwt')
          return { secret: 'test-secret-123', expiresIn: '15m' };
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  describe('cookieExtractor', () => {
    it('returns null when req is null or undefined', () => {
      expect(cookieExtractor(null as unknown as Request)).toBeNull();
      expect(cookieExtractor(undefined as unknown as Request)).toBeNull();
    });

    it('extracts access_token from req.cookies when cookie-parser is used', () => {
      const req = {
        cookies: {
          access_token: 'cookie_token_123',
          other: 'abc',
        },
      } as unknown as Request;

      expect(cookieExtractor(req)).toBe('cookie_token_123');
    });

    it('extracts access_token by parsing req.headers.cookie', () => {
      const req = {
        headers: {
          cookie:
            'session_id=xyz; access_token=raw_header_cookie_token; theme=dark',
        },
      } as unknown as Request;

      expect(cookieExtractor(req)).toBe('raw_header_cookie_token');
    });

    it('decodes percent-encoded cookie values correctly', () => {
      const req = {
        headers: {
          cookie: 'access_token=token%20with%20encoded%20chars',
        },
      } as unknown as Request;

      expect(cookieExtractor(req)).toBe('token with encoded chars');
    });

    it('safely catches malformed percent-encoding and returns null instead of throwing 500 (#462)', () => {
      const req = {
        headers: {
          // Corrupted percent-encoding like %E0%A4%A or trailing %
          cookie: 'access_token=%E0%A4%A; other=test',
        },
      } as unknown as Request;

      expect(() => cookieExtractor(req)).not.toThrow();
      expect(cookieExtractor(req)).toBeNull();
    });

    it('safely catches trailing stray percent and returns null (#462)', () => {
      const req = {
        headers: {
          cookie: 'access_token=token%',
        },
      } as unknown as Request;

      expect(() => cookieExtractor(req)).not.toThrow();
      expect(cookieExtractor(req)).toBeNull();
    });

    it('returns null when access_token is not present in cookie header', () => {
      const req = {
        headers: {
          cookie: 'session=123; tracking=xyz',
        },
      } as unknown as Request;

      expect(cookieExtractor(req)).toBeNull();
    });

    it('returns null when headers.cookie is empty or missing', () => {
      const req = {
        headers: {},
      } as unknown as Request;

      expect(cookieExtractor(req)).toBeNull();
    });
  });

  describe('bearer vs cookie precedence (#593, #462)', () => {
    const combinedExtractor = ExtractJwt.fromExtractors([
      ExtractJwt.fromAuthHeaderAsBearerToken(),
      cookieExtractor,
    ]);

    it('prioritizes Authorization Bearer header when both header and cookie are present', () => {
      const req = {
        headers: {
          authorization: 'Bearer bearer_token_takes_precedence',
          cookie: 'access_token=cookie_fallback_token',
        },
      } as unknown as Request;

      const extracted = combinedExtractor(req);
      expect(extracted).toBe('bearer_token_takes_precedence');
    });

    it('falls back to cookie when Authorization header is absent', () => {
      const req = {
        headers: {
          cookie: 'access_token=cookie_fallback_token',
        },
      } as unknown as Request;

      const extracted = combinedExtractor(req);
      expect(extracted).toBe('cookie_fallback_token');
    });

    it('honors bearer token even when cookie has malformed percent encoding (#462)', () => {
      const req = {
        headers: {
          authorization: 'Bearer valid_bearer_token',
          cookie: 'access_token=%E0%A4%A',
        },
      } as unknown as Request;

      const extracted = combinedExtractor(req);
      expect(extracted).toBe('valid_bearer_token');
    });

    it('returns null when neither bearer header nor valid cookie is present', () => {
      const req = {
        headers: {},
      } as unknown as Request;

      const extracted = combinedExtractor(req);
      expect(extracted).toBeNull();
    });
  });

  describe('validate (#593, #286)', () => {
    it('returns userId and username when payload is valid and user exists', async () => {
      const payload: JwtPayload = {
        sub: '00000000-0000-0000-0000-000000000001',
        username: 'alice',
      };
      usersService.findOneRaw.mockResolvedValue({
        id: payload.sub,
        username: payload.username,
      });

      const result = await strategy.validate(payload);

      expect(usersService.findOneRaw).toHaveBeenCalledWith(payload.sub);
      expect(result).toEqual({
        userId: '00000000-0000-0000-0000-000000000001',
        username: 'alice',
      });
    });

    it('throws UnauthorizedException when sub is missing in payload', async () => {
      const payload = { username: 'alice' } as JwtPayload;

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate(payload)).rejects.toThrow(
        'Invalid token payload',
      );
      expect(usersService.findOneRaw).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when sub is empty string', async () => {
      const payload: JwtPayload = { sub: '', username: 'alice' };

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate(payload)).rejects.toThrow(
        'Invalid token payload',
      );
      expect(usersService.findOneRaw).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when payload is null or undefined', async () => {
      await expect(
        strategy.validate(null as unknown as JwtPayload),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        strategy.validate(undefined as unknown as JwtPayload),
      ).rejects.toThrow(UnauthorizedException);
      expect(usersService.findOneRaw).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException (401) when user no longer exists (deleted user)', async () => {
      const payload: JwtPayload = {
        sub: '00000000-0000-0000-0000-000000000002',
        username: 'deleted_user',
      };
      usersService.findOneRaw.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate(payload)).rejects.toThrow(
        'User no longer exists',
      );
      expect(usersService.findOneRaw).toHaveBeenCalledWith(payload.sub);
    });
  });
});
