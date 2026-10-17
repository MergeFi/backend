import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Injectable } from '@nestjs/common';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

const TEST_SECRET = 'test-secret';

@Injectable()
class MockJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: TEST_SECRET,
    });
  }

  validate(payload: unknown) {
    return payload;
  }
}

describe('UsersController (e2e)', () => {
  let app: INestApplication;

  const mockUsersService = {
    list: jest.fn(),
    findById: jest.fn(),
  };

  const validToken = jwt.sign(
    { sub: '00000000-0000-0000-0000-000000000000', username: 'testuser' },
    TEST_SECRET,
  );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        JwtAuthGuard,
        MockJwtStrategy,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Real JwtAuthGuard', () => {
    describe('GET /users', () => {
      it('should reject unauthenticated requests with 401', () => {
        return request(app.getHttpServer()).get('/users').expect(401);
      });

      it('should reject requests with invalid token with 401', () => {
        return request(app.getHttpServer())
          .get('/users')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);
      });

      it('should return 200 with user list for authenticated request', async () => {
        mockUsersService.list.mockResolvedValueOnce([
          { id: '00000000-0000-0000-0000-000000000000', username: 'testuser' },
        ]);

        const res = await request(app.getHttpServer())
          .get('/users')
          .set('Authorization', `Bearer ${validToken}`)
          .expect(200);

        expect(res.body).toEqual([
          { id: '00000000-0000-0000-0000-000000000000', username: 'testuser' },
        ]);
      });
    });

    describe('GET /users/:id', () => {
      const userId = '00000000-0000-0000-0000-000000000000';

      it('should reject unauthenticated requests with 401', () => {
        return request(app.getHttpServer()).get(`/users/${userId}`).expect(401);
      });

      it('should reject requests with invalid token with 401', () => {
        return request(app.getHttpServer())
          .get(`/users/${userId}`)
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);
      });

      it('should return 200 with user for authenticated request', async () => {
        mockUsersService.findById.mockResolvedValueOnce({
          id: userId,
          username: 'testuser',
        });

        const res = await request(app.getHttpServer())
          .get(`/users/${userId}`)
          .set('Authorization', `Bearer ${validToken}`)
          .expect(200);

        expect(res.body).toEqual({
          id: userId,
          username: 'testuser',
        });
      });
    });
  });

  describe('Guard denial (forbidden)', () => {
    let deniedApp: INestApplication;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        controllers: [UsersController],
        providers: [{ provide: UsersService, useValue: mockUsersService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => false })
        .compile();

      deniedApp = moduleFixture.createNestApplication();
      await deniedApp.init();
    });

    afterAll(async () => {
      await deniedApp.close();
    });

    it('should return 403 when the guard denies the request', () => {
      return request(deniedApp.getHttpServer()).get('/users').expect(403);
    });

    it('should return 403 when the guard denies GET /users/:id', () => {
      return request(deniedApp.getHttpServer())
        .get('/users/00000000-0000-0000-0000-000000000000')
        .expect(403);
    });
  });
});
