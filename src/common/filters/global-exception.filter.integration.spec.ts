import {
  Controller,
  Get,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * Minimal throwaway controller exercising the same shapes described in #19:
 * a raw (non-HttpException) error simulating a Soroban/TypeORM failure, and
 * a legitimate validation-style HttpException. Deliberately doesn't import
 * AppModule (which needs a live Postgres connection) — this only needs the
 * filter wired up exactly as main.ts wires it.
 */
@Controller('test')
class ThrowingController {
  @Get('soroban-failure')
  sorobanFailure(): never {
    throw new Error(
      'Soroban simulation failed: HostError: Error(Contract, #1), account GABC...SECRET123 keypair mismatch',
    );
  }

  @Get('db-failure')
  dbFailure(): never {
    throw new Error(
      'insert or update on table "escrows" violates foreign key constraint "FK_escrows_bountyId"',
    );
  }

  @Get('not-found')
  notFound(): never {
    throw new NotFoundException('Escrow esc_1 not found');
  }

  // Same named-throttler override shape the real mutating routes use
  // (e.g. EscrowController.release), so the 429 below is produced exactly as
  // production produces it (#842).
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Get('throttled')
  throttled(): { ok: true } {
    return { ok: true };
  }
}

describe('GlobalExceptionFilter (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        // Mirrors AppModule's named throttlers (#287). Only `short` is
        // tightened by the route above; the others stay lenient.
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60_000, limit: 120 },
          { name: 'short', ttl: 1_000, limit: 20 },
          { name: 'medium', ttl: 60_000, limit: 120 },
          { name: 'long', ttl: 3_600_000, limit: 5_000 },
        ]),
      ],
      controllers: [ThrowingController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Silence Nest's console logging for this test — we assert on the
    // response body, and separately unit-test that the filter's Logger
    // calls happen (global-exception.filter.spec.ts); no need for either
    // to spam real console output here.
    app.useLogger(false);
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sanitizes a raw Soroban error and never includes its content in the response', async () => {
    const res = await request(app.getHttpServer()).get('/test/soroban-failure');

    expect(res.status).toBe(500);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('SECRET123');
    expect(raw).not.toContain('HostError');
    expect(raw).not.toContain('Contract, #1');
    expect(res.body).toEqual({
      statusCode: 500,
      message: expect.stringContaining('reference ID') as string,
      errorId: expect.any(String) as string,
    });
  });

  it('sanitizes a raw DB error and never includes schema/table detail', async () => {
    const res = await request(app.getHttpServer()).get('/test/db-failure');

    expect(res.status).toBe(500);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('FK_escrows_bountyId');
    expect(raw).not.toContain('violates foreign key');
  });

  it('leaves a legitimate NotFoundException response untouched', async () => {
    const res = await request(app.getHttpServer()).get('/test/not-found');
    const body = res.body as { errorId?: string };

    expect(res.status).toBe(404);
    expect(body).toEqual({
      statusCode: 404,
      message: 'Escrow esc_1 not found',
      error: 'Not Found',
    });
    expect(body.errorId).toBeUndefined();
  });

  /**
   * The 429 is a cross-repository contract (#842): mergefi-frontend's
   * apiRequest (src/lib/api.ts) branches on it, reads `Retry-After` to build
   * the wait message and stores it on ApiRequestError.retryAfter, and reads
   * `message` from the JSON body. Pinned here because this is where the
   * header and body are produced; the frontend's tests mock this shape.
   */
  it('returns a throttled 429 with Retry-After and the body keys the frontend reads', async () => {
    const server = app.getHttpServer();
    await request(server).get('/test/throttled').expect(200);

    const res = await request(server).get('/test/throttled');

    expect(res.status).toBe(429);

    const retryAfter = res.headers['retry-after'];
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number.isInteger(Number(retryAfter))).toBe(true);
    // The short window is 1s, so the client is never told to wait longer.
    expect(Number(retryAfter)).toBeLessThanOrEqual(1);

    expect(res.headers['content-type']).toMatch(/application\/json/);
    const body = res.body as Record<string, unknown>;
    expect(body).toEqual({
      statusCode: 429,
      message: expect.any(String) as string,
      error: 'Too Many Requests',
    });
    expect(body.message).not.toBe('');
    // A 429 is a client error, not an internal one — no correlation id.
    expect(body.errorId).toBeUndefined();
  });
});
