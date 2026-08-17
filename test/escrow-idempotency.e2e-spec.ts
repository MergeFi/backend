import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { EscrowController } from '../src/escrow/escrow.controller';
import { EscrowService } from '../src/escrow/escrow.service';
import { UsersService } from '../src/users/users.service';
import { IdempotencyKey } from '../src/common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../src/common/idempotency/idempotency.interceptor';
import { IdempotencyKeyStatus } from '../src/common/enums';

/**
 * In-memory stand-in for Repository<IdempotencyKey>, matching the DB's
 * unique index on (key, scope, callerId) via a synchronous check-and-push
 * — see idempotency.interceptor.spec.ts's FakeIdempotencyRepo for the full
 * rationale. Deliberately not shared with that file: e2e specs run under a
 * separate Jest config/rootDir (test/jest-e2e.json) from unit specs.
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
    const collision = this.rows.some(
      (r) =>
        r.key === data.key &&
        r.scope === data.scope &&
        r.callerId === data.callerId,
    );
    if (collision) {
      return Promise.reject(
        Object.assign(new Error('duplicate key'), {
          driverError: { code: '23505' },
        }),
      );
    }
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

const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333';

describe('Escrow idempotency: cross-resource key reuse (#54)', () => {
  let app: INestApplication;
  let escrowService: { release: jest.Mock; findOne: jest.Mock };

  beforeAll(async () => {
    escrowService = {
      release: jest.fn(),
      findOne: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [EscrowController],
      providers: [
        { provide: EscrowService, useValue: escrowService },
        // EscrowController resolves UsersService for the funderAddress
        // ownership check on POST /escrow/fund (#40). This suite only exercises
        // the release route, so a bare stub is enough to satisfy DI.
        {
          provide: UsersService,
          useValue: { assertOwnsStellarAddress: jest.fn() },
        },
        IdempotencyInterceptor,
        Reflector,
        {
          provide: getRepositoryToken(IdempotencyKey),
          useValue: new FakeIdempotencyRepo(),
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    escrowService.release.mockReset();
    escrowService.findOne.mockReset();
  });

  it("rejects a second escrow release that reuses escrow A's Idempotency-Key, instead of replaying A's response for B", async () => {
    escrowService.release.mockImplementation(
      (id: string, recipientAddress: string) =>
        Promise.resolve({
          id,
          status: 'released',
          recipientAddress,
        }),
    );

    const releaseA = await request(app.getHttpServer())
      .post('/escrow/escrow-A/release')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({ recipientAddress: 'GADDRESSA' })
      .expect(201);

    expect(releaseA.body).toMatchObject({ id: 'escrow-A', status: 'released' });
    expect(escrowService.release).toHaveBeenCalledTimes(1);

    // Same Idempotency-Key, but a genuinely different resource (#54's
    // reproduction) — must not replay escrow A's cached response as if it
    // were escrow B's.
    const releaseB = await request(app.getHttpServer())
      .post('/escrow/escrow-B/release')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({ recipientAddress: 'GADDRESSB' })
      .expect(422);

    const releaseBBody = releaseB.body as { message: string };
    expect(releaseBBody.message).toMatch(/different request/i);

    // The real handler for escrow B must never have run — pre-fix, this
    // would be called 1 time (for A) but the client would still see what
    // looks like a successful release for B without B's handler ever
    // executing.
    expect(escrowService.release).toHaveBeenCalledTimes(1);
    expect(escrowService.release).not.toHaveBeenCalledWith(
      'escrow-B',
      expect.anything(),
      expect.anything(),
    );
  });

  it('still replays correctly when the same key is retried against the same escrow and body', async () => {
    const key = '44444444-4444-4444-8444-444444444444';
    escrowService.release.mockResolvedValueOnce({
      id: 'escrow-C',
      status: 'released',
    });

    const first = await request(app.getHttpServer())
      .post('/escrow/escrow-C/release')
      .set('Idempotency-Key', key)
      .send({ recipientAddress: 'GADDRESSC' })
      .expect(201);

    const retry = await request(app.getHttpServer())
      .post('/escrow/escrow-C/release')
      .set('Idempotency-Key', key)
      .send({ recipientAddress: 'GADDRESSC' })
      .expect(201);

    expect(retry.body).toEqual(first.body);
    // Only the first call reached the real handler; the retry replayed.
    expect(escrowService.release).toHaveBeenCalledTimes(1);
  });
});
