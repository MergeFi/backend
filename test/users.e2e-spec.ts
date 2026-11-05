import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import request from 'supertest';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

describe('UsersController (e2e) (#612)', () => {
  let app: INestApplication;

  const mockUsersService = {
    list: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000000',
      username: 'testuser',
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          const auth = req.headers['authorization'];
          if (!auth) {
            throw new UnauthorizedException();
          }
          if (auth === 'Bearer forbidden-token') {
            throw new ForbiddenException();
          }
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users', () => {
    it('should return 401 when request has no token', () => {
      return request(app.getHttpServer()).get('/users').expect(401);
    });

    it('should return 403 when access is denied for the token', () => {
      return request(app.getHttpServer())
        .get('/users')
        .set('Authorization', 'Bearer forbidden-token')
        .expect(403);
    });

    it('should return 200 when request is authenticated', () => {
      return request(app.getHttpServer())
        .get('/users')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);
    });
  });

  describe('GET /users/:id', () => {
    it('should return 401 when request has no token', () => {
      return request(app.getHttpServer())
        .get('/users/00000000-0000-0000-0000-000000000000')
        .expect(401);
    });

    it('should return 403 when access is denied for the token', () => {
      return request(app.getHttpServer())
        .get('/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', 'Bearer forbidden-token')
        .expect(403);
    });

    it('should return 200 when request is authenticated', () => {
      return request(app.getHttpServer())
        .get('/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);
    });
  });
});
