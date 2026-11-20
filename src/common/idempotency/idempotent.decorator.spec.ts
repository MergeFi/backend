import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IDEMPOTENCY_SCOPE_KEY, Idempotent } from './idempotent.decorator';

// Metadata keys @nestjs/swagger stores decorator output under. Not part
// of the package's public exports, so mirrored here.
const DECORATORS = {
  API_PARAMETERS: 'swagger/apiParameters',
} as const;

@Controller('idempotency-probe')
class ProbeController {
  calls = 0;

  @Post('guarded')
  @Idempotent('probe.guarded')
  guarded(@Body() body: Record<string, unknown>) {
    this.calls += 1;
    return { ok: true, calls: this.calls, body };
  }

  @Post('unguarded')
  unguarded() {
    return { ok: true };
  }
}

const guardedHandler = Object.getOwnPropertyDescriptor(
  ProbeController.prototype,
  'guarded',
)!.value as (...args: unknown[]) => unknown;
const unguardedHandler = Object.getOwnPropertyDescriptor(
  ProbeController.prototype,
  'unguarded',
)!.value as (...args: unknown[]) => unknown;

/**
 * Minimal in-memory Repository<IdempotencyKey> covering what the real
 * interceptor calls on the happy path and on replay.
 */
function inMemoryRepo() {
  const rows: Record<string, unknown>[] = [];
  const matches = (row: Record<string, unknown>, where: object) =>
    Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    findOneBy: jest.fn((where: object) =>
      Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
    ),
    insert: jest.fn((data: Record<string, unknown>) => {
      rows.push({ ...data, status: 'processing', updatedAt: new Date() });
      return Promise.resolve();
    }),
    update: jest.fn((where: object, patch: object) => {
      rows
        .filter((r) => matches(r, where))
        .forEach((r) => Object.assign(r, patch));
      return Promise.resolve({ affected: 1 });
    }),
    delete: jest.fn(() => Promise.resolve()),
  };
}

describe('@Idempotent', () => {
  const reflector = new Reflector();

  describe('metadata', () => {
    it('sets the scope under IDEMPOTENCY_SCOPE_KEY, readable via Reflector.get on the handler', () => {
      expect(reflector.get(IDEMPOTENCY_SCOPE_KEY, guardedHandler)).toBe(
        'probe.guarded',
      );
    });

    it('yields undefined for a route without the decorator', () => {
      expect(
        reflector.get(IDEMPOTENCY_SCOPE_KEY, unguardedHandler),
      ).toBeUndefined();
    });

    it('binds IdempotencyInterceptor to the decorated handler only', () => {
      expect(
        Reflect.getMetadata(INTERCEPTORS_METADATA, guardedHandler),
      ).toEqual([IdempotencyInterceptor]);
      expect(
        Reflect.getMetadata(INTERCEPTORS_METADATA, unguardedHandler),
      ).toBeUndefined();
    });

    it('documents a required Idempotency-Key UUID header for Swagger', () => {
      const headers = Reflect.getMetadata(
        DECORATORS.API_PARAMETERS,
        guardedHandler,
      ) as Array<Record<string, unknown>>;

      expect(headers).toEqual([
        expect.objectContaining({
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        }),
      ]);
    });

    it('keeps distinct scopes per decorated handler', () => {
      class Other {
        @Idempotent('a.scope')
        a(this: void) {}

        @Idempotent('b.scope')
        b(this: void) {}
      }

      expect(reflector.get(IDEMPOTENCY_SCOPE_KEY, Other.prototype.a)).toBe(
        'a.scope',
      );
      expect(reflector.get(IDEMPOTENCY_SCOPE_KEY, Other.prototype.b)).toBe(
        'b.scope',
      );
    });
  });

  describe('end to end (real Reflector, real interceptor)', () => {
    let app: INestApplication<App>;
    let controller: ProbeController;
    let repo: ReturnType<typeof inMemoryRepo>;

    beforeEach(async () => {
      repo = inMemoryRepo();
      const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
        providers: [
          { provide: getRepositoryToken(IdempotencyKey), useValue: repo },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      app.useLogger(false);
      await app.init();
      controller = moduleRef.get(ProbeController);
    });

    afterEach(async () => {
      await app.close();
    });

    it('rejects a decorated route called without an Idempotency-Key header', async () => {
      const res = await request(app.getHttpServer())
        .post('/idempotency-probe/guarded')
        .send({ amount: 1 });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('Idempotency-Key');
      expect(controller.calls).toBe(0);
    });

    it('rejects a decorated route called with a non-UUID Idempotency-Key', async () => {
      const res = await request(app.getHttpServer())
        .post('/idempotency-probe/guarded')
        .set('Idempotency-Key', 'not-a-uuid')
        .send({ amount: 1 });

      expect(res.status).toBe(400);
      expect(controller.calls).toBe(0);
    });

    it('runs the handler once and replays the cached response for a retried key', async () => {
      const key = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
      const send = () =>
        request(app.getHttpServer())
          .post('/idempotency-probe/guarded')
          .set('Idempotency-Key', key)
          .send({ amount: 1 });

      const first = await send();
      const second = await send();

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(controller.calls).toBe(1);
      expect(repo.rows[0]).toMatchObject({ key, scope: 'probe.guarded' });
    });

    it('does not require the header on an undecorated route', async () => {
      const res = await request(app.getHttpServer()).post(
        '/idempotency-probe/unguarded',
      );

      expect(res.status).toBe(201);
      expect(repo.findOneBy).not.toHaveBeenCalled();
    });
  });
});
