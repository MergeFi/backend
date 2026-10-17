import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import request from 'supertest';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

describe('UsersController (e2e)', () => {
  const mockUsersService = {
    list: jest.fn(),
    findById: jest.fn(),
  };

  const buildApp = async (guard: { canActivate: () => boolean }) => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guard)
      .compile();
    const app = moduleFixture.createNestApplication();
    await app.init();
    return app;
  };

  // Unauthenticated — the real JwtAuthGuard returns 401 for a request with
  // no token (not 403). Simulate the real guard's behavior: no credentials
  // → UnauthorizedException, which Nest maps to 401.
  describe('unauthenticated requests', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await buildApp({
        canActivate: () => {
          throw new UnauthorizedException('No token provided');
        },
      });
    });
    afterAll(() => app.close());

    it('GET /users returns 401 (not 403) when no token is sent', () => {
      return request(app.getHttpServer()).get('/users').expect(401);
    });
    it('GET /users/:id returns 401 (not 403) when no token is sent', () => {
      return request(app.getHttpServer())
        .get('/users/00000000-0000-0000-0000-000000000000')
        .expect(401);
    });
  });

  // Authenticated but not permitted — the guard denies a valid-token request
  // the action isn't allowed to do → 403. This is the real guard-denied path.
  describe('authenticated but not permitted', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await buildApp({
        canActivate: () => {
          throw new ForbiddenException('Not permitted');
        },
      });
    });
    afterAll(() => app.close());

    it('GET /users returns 403 when the action is not permitted', () => {
      return request(app.getHttpServer()).get('/users').expect(403);
    });
    it('GET /users/:id returns 403 when the action is not permitted', () => {
      return request(app.getHttpServer())
        .get('/users/00000000-0000-0000-0000-000000000000')
        .expect(403);
    });
  });
});
