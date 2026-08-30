import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

describe('UsersController (e2e)', () => {
  let app: INestApplication;

  const mockUsersService = {
    list: jest.fn(),
    findById: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => false }) // Simulate a guard-denied request (always 403)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users', () => {
    it('should return 403 when the guard denies the request', () => {
      return request(app.getHttpServer())
        .get('/users')
        .expect(403);
    });
  });

  describe('GET /users/:id', () => {
    it('should return 403 when the guard denies the request', () => {
      return request(app.getHttpServer())
        .get('/users/00000000-0000-0000-0000-000000000000')
        .expect(403);
    });
  });
});
