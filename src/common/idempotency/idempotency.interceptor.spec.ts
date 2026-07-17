import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { firstValueFrom, lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { IdempotencyKeyStatus } from '../enums';
import { IDEMPOTENCY_SCOPE_KEY } from './idempotent.decorator';
import { IdempotencyInterceptor } from './idempotency.interceptor';

const PG_UNIQUE_VIOLATION = '23505';
const STALE_PROCESSING_MS = 30 * 1000;

function uniqueViolationError(): Error & { driverError: { code: string } } {
  return Object.assign(
    new Error('duplicate key value violates unique constraint'),
    { driverError: { code: PG_UNIQUE_VIOLATION } },
  );
}

function matches(
  row: IdempotencyKey,
  criteria: Partial<IdempotencyKey>,
): boolean {
  return (Object.keys(criteria) as (keyof IdempotencyKey)[]).every((k) => {
    const expected = criteria[k];
    const actual = row[k];
    if (expected instanceof Date) {
      return actual instanceof Date && actual.getTime() === expected.getTime();
    }
    return actual === expected;
  });
}

/**
 * In-memory stand-in for Repository<IdempotencyKey> covering only the
 * methods IdempotencyInterceptor calls. `insert` mimics the DB unique
 * index on (key, scope, callerId) — the actual concurrency-safety
 * primitive under test — with a synchronous check-and-push, which is
 * enough to reproduce a real race: JS never preempts mid-microtask, so
 * two `intercept()` calls racing to insert the same key interleave at
 * `await` boundaries exactly like two connections racing a real unique
 * constraint would.
 */
class FakeIdempotencyRepo {
  rows: IdempotencyKey[] = [];
  insertCalls = 0;
  nextId = 1;

  findOneBy(where: Partial<IdempotencyKey>): Promise<IdempotencyKey | null> {
    return Promise.resolve(this.rows.find((r) => matches(r, where)) ?? null);
  }

  insert(data: Partial<IdempotencyKey>): Promise<void> {
    this.insertCalls += 1;
    const collision = this.rows.some(
      (r) =>
        r.key === data.key &&
        r.scope === data.scope &&
        r.callerId === data.callerId,
    );
    if (collision) {
      return Promise.reject(uniqueViolationError());
    }
    const row = {
      id: `row-${this.nextId++}`,
      key: data.key,
      scope: data.scope,
      callerId: data.callerId,
      status: IdempotencyKeyStatus.PROCESSING,
      responseStatus: null,
      responseBody: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: data.expiresAt,
    } as IdempotencyKey;
    this.rows.push(row);
    return Promise.resolve();
  }

  update(
    criteria: Partial<IdempotencyKey>,
    partial: Partial<IdempotencyKey>,
  ): Promise<{ affected: number }> {
    let affected = 0;
    for (const row of this.rows) {
      if (matches(row, criteria)) {
        Object.assign(row, partial);
        affected += 1;
      }
    }
    return Promise.resolve({ affected });
  }

  delete(criteria: Partial<IdempotencyKey>): Promise<{ affected: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matches(r, criteria));
    return Promise.resolve({ affected: before - this.rows.length });
  }
}

const DUMMY_HANDLER = function dummyHandler() {};

function createContext(
  overrides: {
    headers?: Record<string, string>;
    method?: string;
    user?: { userId: string };
  } = {},
): ExecutionContext {
  const request = {
    headers: overrides.headers ?? {},
    method: overrides.method ?? 'POST',
    user: overrides.user,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
    getHandler: () => DUMMY_HANDLER,
  } as unknown as ExecutionContext;
}

function createNext(
  factory: () => ReturnType<CallHandler['handle']>,
): CallHandler & { handle: jest.Mock } {
  return { handle: jest.fn(factory) };
}

function createReflector(scope: string | undefined): { get: jest.Mock } {
  return {
    get: jest.fn((key: string) =>
      key === IDEMPOTENCY_SCOPE_KEY ? scope : undefined,
    ),
  };
}

const KEY_A = '11111111-1111-4111-8111-111111111111';
const KEY_B = '22222222-2222-4222-8222-222222222222';

describe('IdempotencyInterceptor', () => {
  let repo: FakeIdempotencyRepo;
  let reflector: { get: jest.Mock };
  let interceptor: IdempotencyInterceptor;

  beforeEach(() => {
    repo = new FakeIdempotencyRepo();
    reflector = createReflector('test.scope');
    interceptor = new IdempotencyInterceptor(repo as never, reflector as never);
  });

  it('passes through untouched when the route carries no idempotency scope', async () => {
    reflector = createReflector(undefined);
    interceptor = new IdempotencyInterceptor(repo as never, reflector as never);
    const next = createNext(() => of({ ok: true }));
    const context = createContext();

    const result = await lastValueFrom(
      await interceptor.intercept(context, next),
    );

    expect(result).toEqual({ ok: true });
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(repo.insertCalls).toBe(0);
  });

  it('rejects with 400 when the Idempotency-Key header is missing', async () => {
    const next = createNext(() => of({ ok: true }));
    const context = createContext({ headers: {} });

    await expect(interceptor.intercept(context, next)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('rejects with 400 when the Idempotency-Key header is not a UUID', async () => {
    const next = createNext(() => of({ ok: true }));
    const context = createContext({ headers: { 'idempotency-key': 'nope' } });

    await expect(interceptor.intercept(context, next)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('executes the handler once and caches the result on first use', async () => {
    const next = createNext(() => of({ id: 'bounty-1', status: 'funded' }));
    const context = createContext({ headers: { 'idempotency-key': KEY_A } });

    const observable = await interceptor.intercept(context, next);
    const result = await lastValueFrom(observable);

    expect(result).toEqual({ id: 'bounty-1', status: 'funded' });
    expect(next.handle).toHaveBeenCalledTimes(1);

    const row = repo.rows[0];
    expect(row.status).toBe(IdempotencyKeyStatus.COMPLETED);
    expect(row.responseBody).toEqual({ id: 'bounty-1', status: 'funded' });
  });

  it('replays the cached response on a duplicate key without re-executing the handler', async () => {
    const next = createNext(() => of({ id: 'bounty-1', status: 'funded' }));
    const context = createContext({ headers: { 'idempotency-key': KEY_A } });

    await lastValueFrom(await interceptor.intercept(context, next));
    const secondResult = await lastValueFrom(
      await interceptor.intercept(context, next),
    );

    expect(secondResult).toEqual({ id: 'bounty-1', status: 'funded' });
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('executes independently for different keys', async () => {
    const next = createNext(() => of({ ok: true }));
    const contextA = createContext({ headers: { 'idempotency-key': KEY_A } });
    const contextB = createContext({ headers: { 'idempotency-key': KEY_B } });

    await lastValueFrom(await interceptor.intercept(contextA, next));
    await lastValueFrom(await interceptor.intercept(contextB, next));

    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(repo.rows).toHaveLength(2);
  });

  it('does not cache a 5xx outcome, so a retry re-executes the handler', async () => {
    let calls = 0;
    const next = createNext(() => {
      calls += 1;
      if (calls === 1) {
        return throwError(() => new InternalServerErrorException('boom'));
      }
      return of({ ok: true });
    });
    const context = createContext({ headers: { 'idempotency-key': KEY_A } });

    await expect(
      firstValueFrom(await interceptor.intercept(context, next)),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(repo.rows).toHaveLength(0);

    const retryResult = await lastValueFrom(
      await interceptor.intercept(context, next),
    );

    expect(retryResult).toEqual({ ok: true });
    expect(next.handle).toHaveBeenCalledTimes(2);
  });

  it('caches a 4xx outcome and replays the same exception on retry without re-executing', async () => {
    const next = createNext(() =>
      throwError(() => new BadRequestException('insufficient funds')),
    );
    const context = createContext({ headers: { 'idempotency-key': KEY_A } });

    await expect(
      firstValueFrom(await interceptor.intercept(context, next)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].status).toBe(IdempotencyKeyStatus.COMPLETED);

    await expect(interceptor.intercept(context, next)).rejects.toMatchObject({
      status: 400,
      response: { message: 'insufficient funds' },
    });
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('rejects a concurrent duplicate-key request with 409 and only executes the handler once', async () => {
    const next = createNext(() => of({ ok: true }));
    const context = createContext({ headers: { 'idempotency-key': KEY_A } });

    const first = interceptor.intercept(context, next);
    const second = interceptor.intercept(context, next);

    const [firstOutcome, secondOutcome] = await Promise.allSettled([
      first,
      second,
    ]);

    expect(firstOutcome.status).toBe('fulfilled');
    expect(secondOutcome.status).toBe('rejected');
    if (secondOutcome.status === 'rejected') {
      expect(secondOutcome.reason).toBeInstanceOf(ConflictException);
    }
    if (firstOutcome.status === 'fulfilled') {
      await lastValueFrom(firstOutcome.value);
    }

    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(repo.rows).toHaveLength(1);
  });

  it('reclaims a stale PROCESSING row instead of 409-ing forever', async () => {
    const context = createContext({ headers: { 'idempotency-key': KEY_A } });
    await repo.insert({
      key: KEY_A,
      scope: 'test.scope',
      callerId: 'anonymous',
      expiresAt: new Date(Date.now() + 60_000),
    });
    // Simulate the original request having crashed mid-handler: back-date
    // updatedAt past the staleness threshold instead of it being a
    // genuinely in-flight request.
    repo.rows[0].updatedAt = new Date(Date.now() - STALE_PROCESSING_MS - 1);

    const next = createNext(() => of({ ok: true, reclaimed: true }));
    const result = await lastValueFrom(
      await interceptor.intercept(context, next),
    );

    expect(result).toEqual({ ok: true, reclaimed: true });
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(repo.rows[0].status).toBe(IdempotencyKeyStatus.COMPLETED);
  });

  it('rejects with 409 while a PROCESSING row is still fresh', async () => {
    const context = createContext({ headers: { 'idempotency-key': KEY_A } });
    await repo.insert({
      key: KEY_A,
      scope: 'test.scope',
      callerId: 'anonymous',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const next = createNext(() => of({ ok: true }));

    await expect(interceptor.intercept(context, next)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('scopes keys per authenticated caller when req.user is present', async () => {
    const next = createNext(() => of({ ok: true }));
    const contextUser1 = createContext({
      headers: { 'idempotency-key': KEY_A },
      user: { userId: 'user-1' },
    });
    const contextUser2 = createContext({
      headers: { 'idempotency-key': KEY_A },
      user: { userId: 'user-2' },
    });

    await lastValueFrom(await interceptor.intercept(contextUser1, next));
    await lastValueFrom(await interceptor.intercept(contextUser2, next));

    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(repo.rows.map((r) => r.callerId).sort()).toEqual([
      'user-1',
      'user-2',
    ]);
  });
});
