import {
  Controller,
  Get,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
}

describe('GlobalExceptionFilter (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ThrowingController],
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
});
