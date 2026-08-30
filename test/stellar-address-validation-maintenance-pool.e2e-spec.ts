import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { MaintenancePoolController } from '../src/maintenance-pool/maintenance-pool.controller';
import { MaintenancePoolService } from '../src/maintenance-pool/maintenance-pool.service';
import { IdempotencyKeyStatus } from '../src/common/enums';
import { IdempotencyKey } from '../src/common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../src/common/idempotency/idempotency.interceptor';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';

/** Same in-memory stand-in used across this directory's e2e specs — see
 * escrow-idempotency.e2e-spec.ts's FakeIdempotencyRepo for the rationale
 * behind duplicating it per file instead of sharing one implementation. */
class FakeIdempotencyRepo {
  rows: Partial<IdempotencyKey>[] = [];

  findOneBy(
    where: Partial<IdempotencyKey>,
  ): Promise<Partial<IdempotencyKey> | null> {
    return Promise.resolve(
      this.rows.find((r) =>
        (Object.keys(where) as (keyof IdempotencyKey)[]).every(
          (k) => r[k] === where[k],
        ),
      ) ?? null,
    );
  }

  insert(data: Partial<IdempotencyKey>): Promise<void> {
    this.rows.push({
      ...data,
      status: IdempotencyKeyStatus.PROCESSING,
      responseStatus: null,
      responseBody: null,
      updatedAt: new Date(),
    });
    return Promise.resolve();
  }

  update(
    criteria: Partial<IdempotencyKey>,
    partial: Partial<IdempotencyKey>,
  ): Promise<{ affected: number }> {
    let affected = 0;
    for (const row of this.rows) {
      if (
        (Object.keys(criteria) as (keyof IdempotencyKey)[]).every(
          (k) => row[k] === criteria[k],
        )
      ) {
        Object.assign(row, partial);
        affected += 1;
      }
    }
    return Promise.resolve({ affected });
  }

  delete(criteria: Partial<IdempotencyKey>): Promise<{ affected: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (r) =>
        !(Object.keys(criteria) as (keyof IdempotencyKey)[]).every(
          (k) => r[k] === criteria[k],
        ),
    );
    return Promise.resolve({ affected: before - this.rows.length });
  }
}

function checksumInvalidAddress(): string {
  const valid = Keypair.random().publicKey();
  const flippedChar = valid[10] === 'A' ? 'B' : 'A';
  const candidate = valid.slice(0, 10) + flippedChar + valid.slice(11);
  if (StrKey.isValidEd25519PublicKey(candidate)) {
    return checksumInvalidAddress();
  }
  return candidate;
}

describe('Stellar address validation at the API boundary — maintenance-pool endpoints (#60)', () => {
  let app: INestApplication;
  let poolService: { deposit: jest.Mock; assignReward: jest.Mock };

  beforeAll(async () => {
    poolService = {
      deposit: jest.fn().mockResolvedValue({ id: 'pool_1' }),
      assignReward: jest.fn().mockResolvedValue({ id: 'pool_1' }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MaintenancePoolController],
      providers: [
        { provide: MaintenancePoolService, useValue: poolService },
        IdempotencyInterceptor,
        Reflector,
        {
          provide: getRepositoryToken(IdempotencyKey),
          useValue: new FakeIdempotencyRepo(),
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
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
    poolService.deposit.mockClear();
    poolService.assignReward.mockClear();
  });

  const badAddresses = () => [
    '',
    'not-an-address',
    'G'.repeat(55),
    checksumInvalidAddress(),
  ];

  it.each(badAddresses())(
    'rejects POST /maintenance-pools/:id/deposit with a malformed funderAddress (%p) as 400',
    async (bad) => {
      await request(app.getHttpServer())
        .post('/maintenance-pools/pool_1/deposit')
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '10.0000000', funderAddress: bad })
        .expect(400);

      expect(poolService.deposit).not.toHaveBeenCalled();
    },
  );

  it('accepts POST /maintenance-pools/:id/deposit with a valid funderAddress', async () => {
    await request(app.getHttpServer())
      .post('/maintenance-pools/pool_1/deposit')
      .set('Idempotency-Key', randomUUID())
      .send({
        amount: '10.0000000',
        funderAddress: Keypair.random().publicKey(),
      })
      .expect(201);

    expect(poolService.deposit).toHaveBeenCalledTimes(1);
  });

  it.each(badAddresses())(
    'rejects POST /maintenance-pools/:id/assign-reward with a malformed recipientAddress (%p) as 400',
    async (bad) => {
      await request(app.getHttpServer())
        .post('/maintenance-pools/pool_1/assign-reward')
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '5.0000000', recipientAddress: bad })
        .expect(400);

      expect(poolService.assignReward).not.toHaveBeenCalled();
    },
  );

  it('accepts POST /maintenance-pools/:id/assign-reward with a valid recipientAddress', async () => {
    await request(app.getHttpServer())
      .post('/maintenance-pools/pool_1/assign-reward')
      .set('Idempotency-Key', randomUUID())
      .send({
        issueId: randomUUID(),
        amount: '5.0000000',
        recipientAddress: Keypair.random().publicKey(),
      })
      .expect(201);

    expect(poolService.assignReward).toHaveBeenCalledTimes(1);
  });
});
