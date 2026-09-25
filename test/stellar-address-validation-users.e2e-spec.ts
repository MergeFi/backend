import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

function checksumInvalidAddress(): string {
  const valid = Keypair.random().publicKey();
  const flippedChar = valid[10] === 'A' ? 'B' : 'A';
  const candidate = valid.slice(0, 10) + flippedChar + valid.slice(11);
  if (StrKey.isValidEd25519PublicKey(candidate)) {
    return checksumInvalidAddress();
  }
  return candidate;
}

describe('Stellar address validation at the API boundary — users endpoint (#292)', () => {
  let app: INestApplication;
  let usersService: { setStellarAddress: jest.Mock };

  beforeAll(async () => {
    usersService = {
      setStellarAddress: jest.fn().mockResolvedValue({ id: 'user_1' }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    usersService.setStellarAddress.mockClear();
  });

  const badAddresses = () => [
    '',
    'not-an-address',
    'G'.repeat(55),
    checksumInvalidAddress(),
    // A secret key must never be accepted where a public key is expected.
    Keypair.random().secret(),
  ];

  it.each(badAddresses())(
    'rejects PATCH /users/:id/stellar-address with a malformed stellarAddress (%p) as 400',
    async (bad) => {
      await request(app.getHttpServer())
        .patch(`/users/${randomUUID()}/stellar-address`)
        .send({ stellarAddress: bad })
        .expect(400);

      expect(usersService.setStellarAddress).not.toHaveBeenCalled();
    },
  );

  it('rejects PATCH /users/:id/stellar-address with a missing stellarAddress as 400', async () => {
    await request(app.getHttpServer())
      .patch(`/users/${randomUUID()}/stellar-address`)
      .send({})
      .expect(400);

    expect(usersService.setStellarAddress).not.toHaveBeenCalled();
  });

  it('accepts PATCH /users/:id/stellar-address with a valid stellarAddress', async () => {
    const id = randomUUID();
    const address = Keypair.random().publicKey();

    await request(app.getHttpServer())
      .patch(`/users/${id}/stellar-address`)
      .send({ stellarAddress: address })
      .expect(200);

    expect(usersService.setStellarAddress).toHaveBeenCalledWith(id, address);
  });
});
