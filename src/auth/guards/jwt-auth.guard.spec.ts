import {
  Controller,
  Get,
  INestApplication,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { UsersService } from '../../users/users.service';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'jwt-guard-spec-secret';

@Controller()
class ProtectedController {
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request) {
    return req.user;
  }
}

/**
 * Exercises JwtAuthGuard end-to-end through the real JwtStrategy. The
 * frontend's AuthContext.refresh clears its token only on 401/403, so the
 * status code for every rejection below is part of the contract (#819, #612).
 */
describe('JwtAuthGuard', () => {
  let app: INestApplication<App>;
  let usersService: { findOneRaw: jest.Mock };
  const jwt = new JwtService({ secret: SECRET });

  const sign = (
    payload: Record<string, unknown> = { sub: 'user-1', username: 'octo' },
    options: { secret?: string; expiresIn?: number } = {},
  ) => jwt.sign(payload, { secret: SECRET, expiresIn: 3600, ...options });

  beforeAll(async () => {
    usersService = { findOneRaw: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProtectedController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        { provide: UsersService, useValue: usersService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue({ secret: SECRET }) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    usersService.findOneRaw.mockReset().mockResolvedValue({ id: 'user-1' });
  });

  afterAll(async () => {
    await app.close();
  });

  const UNAUTHORIZED = { statusCode: 401, message: 'Unauthorized' };

  describe('rejects with 401', () => {
    it('when no credentials are sent', async () => {
      const res = await request(app.getHttpServer()).get('/me');
      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTHORIZED);
      expect(usersService.findOneRaw).not.toHaveBeenCalled();
    });

    it('when the bearer token is malformed', async () => {
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', 'Bearer not.a.jwt');
      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTHORIZED);
    });

    it('when the Authorization scheme is not Bearer', async () => {
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Basic ${sign()}`);
      expect(res.status).toBe(401);
    });

    it('when the token has expired', async () => {
      const expired = sign(undefined, { expiresIn: -60 });
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTHORIZED);
      expect(usersService.findOneRaw).not.toHaveBeenCalled();
    });

    it('when the token is signed with a different secret', async () => {
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${sign(undefined, { secret: 'other' })}`);
      expect(res.status).toBe(401);
      expect(usersService.findOneRaw).not.toHaveBeenCalled();
    });

    it('when the payload has no sub', async () => {
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${sign({ username: 'octo' })}`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid token payload');
    });

    it('when the user behind a valid token no longer exists', async () => {
      usersService.findOneRaw.mockRejectedValue(new Error('not found'));
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${sign()}`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('User no longer exists');
    });

    it('when the access_token cookie is invalid', async () => {
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Cookie', 'access_token=garbage');
      expect(res.status).toBe(401);
    });
  });

  describe('admits', () => {
    it('a valid bearer token and exposes the user on req.user', async () => {
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${sign()}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: 'user-1', username: 'octo' });
      expect(usersService.findOneRaw).toHaveBeenCalledWith('user-1');
    });

    it('a valid access_token cookie', async () => {
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Cookie', `theme=dark; access_token=${sign()}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: 'user-1', username: 'octo' });
    });

    it('prefers the bearer token over the cookie when both are sent', async () => {
      const bearer = sign({ sub: 'bearer-user', username: 'bearer' });
      const cookie = sign({ sub: 'cookie-user', username: 'cookie' });
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${bearer}`)
        .set('Cookie', `access_token=${cookie}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: 'bearer-user', username: 'bearer' });
    });
  });
});
