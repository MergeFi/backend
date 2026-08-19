import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { EscrowController } from '../src/escrow/escrow.controller';
import { EscrowService } from '../src/escrow/escrow.service';
import { AssetType, IdempotencyKeyStatus } from '../src/common/enums';
import { IdempotencyKey } from '../src/common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../src/common/idempotency/idempotency.interceptor';

/**
 * Same in-memory stand-in as escrow-idempotency.e2e-spec.ts's
 * FakeIdempotencyRepo. Deliberately duplicated rather than shared — see
 * that file's doc comment for why (separate rootDir per e2e-spec run).
 */
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

/** A right-length (56-char), StrKey-alphabet string whose checksum is invalid. */
function checksumInvalidAddress(): string {
  const valid = Keypair.random().publicKey();
  const flippedChar = valid[10] === 'A' ? 'B' : 'A';
  const candidate = valid.slice(0, 10) + flippedChar + valid.slice(11);
  if (StrKey.isValidEd25519PublicKey(candidate)) {
    // Vanishingly unlikely (a single-character flip landing on another
    // valid checksum), but re-roll rather than risk a flaky assertion.
    return checksumInvalidAddress();
  }
  return candidate;
}

describe('Stellar address validation at the API boundary — escrow endpoints (#60)', () => {
  let app: INestApplication;
  let escrowService: {
    fund: jest.Mock;
    release: jest.Mock;
    splitRelease: jest.Mock;
  };

  beforeAll(async () => {
    escrowService = {
      fund: jest.fn().mockResolvedValue({ id: 'esc_1', status: 'locked' }),
      release: jest.fn().mockResolvedValue({ id: 'esc_1', status: 'released' }),
      splitRelease: jest.fn().mockResolvedValue([]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [EscrowController],
      providers: [
        { provide: EscrowService, useValue: escrowService },
        IdempotencyInterceptor,
        Reflector,
        {
          provide: getRepositoryToken(IdempotencyKey),
          useValue: new FakeIdempotencyRepo(),
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors main.ts's ValidationPipe config exactly — this is what
    // actually enforces @IsStellarAddress() at the HTTP boundary; none of
    // this repo's other e2e specs apply it, so it isn't inherited.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    escrowService.fund.mockClear();
    escrowService.release.mockClear();
    escrowService.splitRelease.mockClear();
  });

  const badAddresses = () => [
    '',
    'not-an-address',
    'G'.repeat(55), // wrong length
    checksumInvalidAddress(),
  ];

  it.each(badAddresses())(
    'rejects POST /escrow/fund with a malformed funderAddress (%p) as 400, never reaching EscrowService',
    async (bad) => {
      await request(app.getHttpServer())
        .post('/escrow/fund')
        .set('Idempotency-Key', randomUUID())
        .send({
          amount: '10.0000000',
          asset: AssetType.USDC,
          funderAddress: bad,
          bountyId: '11111111-1111-4111-8111-111111111111',
        })
        .expect(400);

      expect(escrowService.fund).not.toHaveBeenCalled();
    },
  );

  it('accepts POST /escrow/fund with a valid funderAddress', async () => {
    await request(app.getHttpServer())
      .post('/escrow/fund')
      .set('Idempotency-Key', randomUUID())
      .send({
        amount: '10.0000000',
        asset: AssetType.USDC,
        funderAddress: Keypair.random().publicKey(),
        bountyId: '11111111-1111-4111-8111-111111111111',
      })
      .expect(201);

    expect(escrowService.fund).toHaveBeenCalledTimes(1);
  });

  it.each(badAddresses())(
    'rejects POST /escrow/:id/release with a malformed recipientAddress (%p) as 400, never reaching EscrowService',
    async (bad) => {
      await request(app.getHttpServer())
        .post('/escrow/esc_1/release')
        .set('Idempotency-Key', randomUUID())
        .send({ recipientAddress: bad })
        .expect(400);

      expect(escrowService.release).not.toHaveBeenCalled();
    },
  );

  it('accepts POST /escrow/:id/release with a valid recipientAddress', async () => {
    await request(app.getHttpServer())
      .post('/escrow/esc_1/release')
      .set('Idempotency-Key', randomUUID())
      .send({ recipientAddress: Keypair.random().publicKey() })
      .expect(201);

    expect(escrowService.release).toHaveBeenCalledTimes(1);
  });

  it('rejects POST /escrow/:id/split-release when any recipient in the array has a malformed recipientAddress', async () => {
    await request(app.getHttpServer())
      .post('/escrow/esc_1/split-release')
      .set('Idempotency-Key', randomUUID())
      .send({
        recipients: [
          { recipientAddress: Keypair.random().publicKey(), percentage: 50 },
          { recipientAddress: checksumInvalidAddress(), percentage: 50 },
        ],
      })
      .expect(400);

    expect(escrowService.splitRelease).not.toHaveBeenCalled();
  });

  it('accepts POST /escrow/:id/split-release when every recipient has a valid recipientAddress', async () => {
    await request(app.getHttpServer())
      .post('/escrow/esc_1/split-release')
      .set('Idempotency-Key', randomUUID())
      .send({
        recipients: [
          { recipientAddress: Keypair.random().publicKey(), percentage: 60 },
          { recipientAddress: Keypair.random().publicKey(), percentage: 40 },
        ],
      })
      .expect(201);

    expect(escrowService.splitRelease).toHaveBeenCalledTimes(1);
  });
});
