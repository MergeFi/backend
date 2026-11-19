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
import type { Request } from 'express';
import request from 'supertest';
import { UsersService } from '../../users/users.service';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'jwt-guard-spec-secret';

@Controller('protected')
class ProtectedController {
  @Get()
  @UseGuards(JwtAuthGuard)
  get(@Req() req: Request) {
    return { user: req.user };
  }
}

/**
 * Runs the real JwtAuthGuard + JwtStrategy over HTTP so the status codes and
 * bodies the frontend branches on (AuthContext.refresh clears the token on
 * 401/403) are pinned end to end (#819, #612).
 */
describe('JwtAuthGuard', () => {
  let app: INestApplication;
  let usersService: { findOneRaw: jest.Mock };
  const jwt = new JwtService({ secret: SECRET });

  const validToken = () =>
    jwt.sign({ sub: 'user-1', username: 'octocat' }, { expiresIn: '1h' });

  beforeAll(async () => {
    usersService = { findOneRaw: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProtectedController],
      providers: [
        JwtAuthGuard,
        JwtStrategy,
        { provide: UsersService, useValue: usersService },
        {
          provide: ConfigService,
          useValue: { get: () => ({ secret: SECRET }) },
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

  describe('rejects with 401 (never 403)', () => {
    it('when no credentials are sent', async () => {
      const res = await request(app.getHttpServer()).get('/protected');
      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTHORIZED);
    });

    it('for a malformed bearer token', async () => {
      const res = await request(app.getHttpServer())
        .get('/protected')
        .set('Authorization', 'Bearer not.a.jwt');
      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTHORIZED);
    });

    it('for a non-Bearer Authorization scheme', async () => {
      const res = await request(app.getHttpServer())
        .get('/protected')
        .set('Authorization', `Basic ${validToken()}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTHORIZED);
    });

    it('for a token signed with a different secret', async () => {
      const forged = new JwtService({ secret: 'other-secret' }).sign({
        sub: 'user-1',
        username: 'octocat',
      });
      const res = await request(app.getHttpServer())
        .get('/protected')
        .set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTHORIZED);
    });

    it('for an expired token', async () => {
      const expired = jwt.sign({
        sub: 'user-1',
        username: 'octocat',
        exp: Math.floor(Date.now() / 1000) - 60,
      });
      const res = await request(app.getHttpServer())
        .get('/protected')
        .set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTHORIZED);
      expect(usersService.findOneRaw).not.toHaveBeenCalled();
    });

    it('for a valid token whose user no longer exists', async () => {
      usersService.findOneRaw.mockRejectedValue(new Error('not found'));
      const res = await request(app.getHttpServer())
        .get('/protected')
        .set('Authorization', `Bearer ${validToken()}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        statusCode: 401,
        message: 'User no longer exists',
        error: 'Unauthorized',
      });
    });

    it('for a valid token with no sub claim', async () => {
      const noSub = jwt.sign({ username: 'octocat' });
      const res = await request(app.getHttpServer())
        .get('/protected')
        .set('Authorization', `Bearer ${noSub}`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid token payload');
    });
  });

  describe('accepts', () => {
    it('a valid bearer token and exposes { userId, username } on req.user', async () => {
      const res = await request(app.getHttpServer())
        .get('/protected')
        .set('Authorization', `Bearer ${validToken()}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        user: { userId: 'user-1', username: 'octocat' },
      });
      expect(usersService.findOneRaw).toHaveBeenCalledWith('user-1');
    });

    it('a valid access_token cookie', async () => {
      const res = await request(app.getHttpServer())
        .get('/protected')
        .set('Cookie', `access_token=${validToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({ userId: 'user-1', username: 'octocat' });
    });
  });

  describe('bearer vs cookie precedence', () => {
    it('uses the bearer token when both are present', async () => {
      const res = await request(app.getHttpServer())
        .get('/protected')
        .set('Authorization', `Bearer ${validToken()}`)
        .set('Cookie', 'access_token=garbage');
      expect(res.status).toBe(200);
    });

    it('does not fall back to a valid cookie when the bearer token is invalid', async () => {
      const res = await request(app.getHttpServer())
        .get('/protected')
        .set('Authorization', 'Bearer garbage')
        .set('Cookie', `access_token=${validToken()}`);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTHORIZED);
    });
  });
});
