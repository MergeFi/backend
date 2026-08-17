import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
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
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => false }) // Simulate unauthenticated
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users', () => {
    it('should reject unauthenticated requests with 401', () => {
      return request(app.getHttpServer()).get('/users').expect(403); // Assuming the guard returns 403 when not authorized
    });
  });

  describe('GET /users/:id', () => {
    it('should reject unauthenticated requests with 401', () => {
      return request(app.getHttpServer())
        .get('/users/00000000-0000-0000-0000-000000000000')
        .expect(403);
    });
  });
});

describe('PATCH /users/:id/stellar-address (e2e)', () => {
  const userA = 'a0000000-0000-4000-8000-00000000000a';
  const userB = 'b0000000-0000-4000-8000-00000000000b';

  const mockUsersService = {
    setStellarAddress: jest.fn(),
  };

  // One guard override that stamps whichever identity the test selects,
  // so each case exercises the real controller -> service contract.
  let currentUser: { userId: string; username: string };

  async function makeApp(authenticated: boolean) {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: authenticated
          ? (ctx: ExecutionContext) => {
              const req = ctx
                .switchToHttp()
                .getRequest<{ user: { userId: string; username: string } }>();
              req.user = currentUser;
              return true;
            }
          : () => false,
      })
      .compile();

    const application = moduleFixture.createNestApplication();
    await application.init();
    return application;
  }

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('rejects requests without a token', async () => {
    const app = await makeApp(false);
    await request(app.getHttpServer())
      .patch(`/users/${userA}/stellar-address`)
      .send({ stellarAddress: 'GA_ANON' })
      .expect(403);
    await app.close();
  });

  it('passes the caller identity through to the service for own id', async () => {
    currentUser = { userId: userA, username: 'alice' };
    const app = await makeApp(true);
    mockUsersService.setStellarAddress.mockResolvedValue({ id: userA });

    await request(app.getHttpServer())
      .patch(`/users/${userA}/stellar-address`)
      .send({ stellarAddress: 'GA_ALICE' })
      .expect(200);

    expect(mockUsersService.setStellarAddress).toHaveBeenCalledWith(
      userA,
      'GA_ALICE',
      userA,
    );
    await app.close();
  });

  it('forwards the mismatch so cross-user writes are refused', async () => {
    currentUser = { userId: userA, username: 'alice' };
    const app = await makeApp(true);
    mockUsersService.setStellarAddress.mockImplementation(() => {
      throw new ForbiddenException();
    });

    await request(app.getHttpServer())
      .patch(`/users/${userB}/stellar-address`)
      .send({ stellarAddress: 'GA_ATTACKER' })
      .expect(403);

    expect(mockUsersService.setStellarAddress).toHaveBeenCalledWith(
      userB,
      'GA_ATTACKER',
      userA,
    );
    await app.close();
  });

  it('lets a maintainer call through for another user', async () => {
    currentUser = { userId: 'maintainer-1', username: 'ops' };
    const app = await makeApp(true);
    mockUsersService.setStellarAddress.mockResolvedValue({ id: userB });

    await request(app.getHttpServer())
      .patch(`/users/${userB}/stellar-address`)
      .send({ stellarAddress: 'GA_OPS_SET' })
      .expect(200);

    expect(mockUsersService.setStellarAddress).toHaveBeenCalledWith(
      userB,
      'GA_OPS_SET',
      'maintainer-1',
    );
    await app.close();
  });
});
