import { BadRequestException, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { EscrowController } from '../src/escrow/escrow.controller';
import { EscrowService } from '../src/escrow/escrow.service';
import { IdempotencyKey } from '../src/common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../src/common/idempotency/idempotency.interceptor';
import { IdempotencyKeyStatus } from '../src/common/enums';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';

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
  let idempotencyRepo: FakeIdempotencyRepo;

  beforeAll(async () => {
    escrowService = {
      release: jest.fn(),
      findOne: jest.fn(),
    };
    idempotencyRepo = new FakeIdempotencyRepo();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [EscrowController],
      providers: [
        { provide: EscrowService, useValue: escrowService },
        IdempotencyInterceptor,
        Reflector,
        {
          provide: getRepositoryToken(IdempotencyKey),
          useValue: idempotencyRepo,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

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
      .post('/escrow/11111111-1111-4111-8111-111111111111/release')
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({ recipientAddress: 'GADDRESSA' })
      .expect(201);

    expect(releaseA.body).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'released',
    });
    expect(escrowService.release).toHaveBeenCalledTimes(1);

    // Same Idempotency-Key, but a genuinely different resource (#54's
    // reproduction) — must not replay escrow A's cached response as if it
    // were escrow B's.
    const releaseB = await request(app.getHttpServer())
      .post('/escrow/22222222-2222-4222-8222-222222222222/release')
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
      '22222222-2222-4222-8222-222222222222',
      expect.anything(),
      expect.anything(),
    );
  });

  it('requires Idempotency-Key on an @Idempotent route through the real Nest HTTP stack', async () => {
    await request(app.getHttpServer())
      .post('/escrow/44444444-4444-4444-8444-444444444444/release')
      .send({ recipientAddress: 'GADDRESSD' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toMatch(/Idempotency-Key/i);
      });
    expect(escrowService.release).not.toHaveBeenCalled();
  });

  it('still replays correctly when the same key is retried against the same escrow and body', async () => {
    const key = '44444444-4444-4444-8444-444444444444';
    escrowService.release.mockResolvedValueOnce({
      id: 'escrow-C',
      status: 'released',
    });

    const first = await request(app.getHttpServer())
      .post('/escrow/33333333-3333-4333-8333-333333333333/release')
      .set('Idempotency-Key', key)
      .send({ recipientAddress: 'GADDRESSC' })
      .expect(201);

    const retry = await request(app.getHttpServer())
      .post('/escrow/33333333-3333-4333-8333-333333333333/release')
      .set('Idempotency-Key', key)
      .send({ recipientAddress: 'GADDRESSC' })
      .expect(201);

    expect(retry.body).toEqual(first.body);
    // Only the first call reached the real handler; the retry replayed.
    expect(escrowService.release).toHaveBeenCalledTimes(1);
  });

  describe('failure replay policy (#843)', () => {
    const ESCROW_ID = '55555555-5555-4555-8555-555555555555';
    const releaseUrl = `/escrow/${ESCROW_ID}/release`;

    it('replays a cached 4xx verbatim on retry instead of re-running the release', async () => {
      const key = '66666666-6666-4666-8666-666666666666';
      escrowService.release.mockRejectedValue(
        new BadRequestException(
          `Escrow ${ESCROW_ID} is not in LOCKED state (current: released)`,
        ),
      );

      const first = await request(app.getHttpServer())
        .post(releaseUrl)
        .set('Idempotency-Key', key)
        .send({ recipientAddress: 'GADDRESSE' })
        .expect(400);

      const retry = await request(app.getHttpServer())
        .post(releaseUrl)
        .set('Idempotency-Key', key)
        .send({ recipientAddress: 'GADDRESSE' })
        .expect(400);

      // Same status and byte-for-byte the same error body the client saw
      // the first time...
      expect(retry.body).toEqual(first.body);
      expect((retry.body as { message: string }).message).toMatch(
        /not in LOCKED state/,
      );
      // ...and the escrow mutation ran exactly once.
      expect(escrowService.release).toHaveBeenCalledTimes(1);
      expect(idempotencyRepo.rows.find((r) => r.key === key)).toMatchObject({
        status: IdempotencyKeyStatus.COMPLETED,
        responseStatus: 400,
      });
    });

    it('releases the key after a non-HttpException failure so the retry re-runs the release', async () => {
      const key = '77777777-7777-4777-8777-777777777777';
      escrowService.release
        .mockRejectedValueOnce(new Error('soroban rpc unavailable'))
        .mockResolvedValueOnce({ id: ESCROW_ID, status: 'released' });

      await request(app.getHttpServer())
        .post(releaseUrl)
        .set('Idempotency-Key', key)
        .send({ recipientAddress: 'GADDRESSF' })
        .expect(500);

      // A transient failure must not be cached: the key row is gone, so the
      // failure isn't made permanent for this key.
      expect(idempotencyRepo.rows.some((r) => r.key === key)).toBe(false);

      const retry = await request(app.getHttpServer())
        .post(releaseUrl)
        .set('Idempotency-Key', key)
        .send({ recipientAddress: 'GADDRESSF' })
        .expect(201);

      expect(retry.body).toMatchObject({ id: ESCROW_ID, status: 'released' });
      expect(escrowService.release).toHaveBeenCalledTimes(2);
      expect(idempotencyRepo.rows.find((r) => r.key === key)).toMatchObject({
        status: IdempotencyKeyStatus.COMPLETED,
        responseStatus: 201,
      });
    });
  });
});
