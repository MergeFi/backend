import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { firstValueFrom, lastValueFrom, NEVER, of, throwError } from 'rxjs';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { IdempotencyKeyStatus } from '../enums';
import { IDEMPOTENCY_SCOPE_KEY } from './idempotent.decorator';
import {
  IdempotencyInterceptor,
  STALE_PROCESSING_MS,
} from './idempotency.interceptor';
import { POLL_CEILING_MS } from '../../escrow/soroban-client.service';

const PG_UNIQUE_VIOLATION = '23505';

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
      // Mirrors Postgres: an unspecified nullable column is NULL, not
      // undefined — matters for rows seeded directly via repo.insert() in
      // tests that simulate a pre-#54 row with no fingerprint on record.
      requestFingerprint: data.requestFingerprint ?? null,
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
    ip?: string;
    params?: Record<string, string>;
    body?: unknown;
    route?: { path: string };
  } = {},
): ExecutionContext {
  const request = {
    headers: overrides.headers ?? {},
    method: overrides.method ?? 'POST',
    user: overrides.user,
    ip: overrides.ip ?? DEFAULT_IP,
    params: overrides.params ?? {},
    body: overrides.body ?? {},
    route: overrides.route,
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

const DEFAULT_IP = '203.0.113.10';
const OTHER_IP = '198.51.100.7';
const DEFAULT_BUCKET = `ip:${DEFAULT_IP}`;

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

  it('releases the key on a non-HttpException failure, so a retry re-executes the handler (#843)', async () => {
    let calls = 0;
    const next = createNext(() => {
      calls += 1;
      if (calls === 1) {
        // e.g. a Soroban RPC/network failure surfacing as a plain Error —
        // not a deterministic outcome, so it must not be cached.
        return throwError(() => new Error('soroban rpc unavailable'));
      }
      return of({ ok: true });
    });
    const context = createContext({ headers: { 'idempotency-key': KEY_A } });

    await expect(
      firstValueFrom(await interceptor.intercept(context, next)),
    ).rejects.toThrow('soroban rpc unavailable');
    // The key row is gone after the first attempt, not left COMPLETED with
    // a cached failure.
    expect(repo.rows).toHaveLength(0);

    const retryResult = await lastValueFrom(
      await interceptor.intercept(context, next),
    );

    expect(retryResult).toEqual({ ok: true });
    expect(next.handle).toHaveBeenCalledTimes(2);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].status).toBe(IdempotencyKeyStatus.COMPLETED);
  });

  it('caches the exact 4xx status and body, not just the exception type (#843)', async () => {
    const next = createNext(() =>
      throwError(
        () =>
          new BadRequestException(
            'Escrow e-1 is not in LOCKED state (current: released)',
          ),
      ),
    );
    const context = createContext({ headers: { 'idempotency-key': KEY_A } });

    const first = await firstValueFrom(
      await interceptor.intercept(context, next),
    ).catch((error: unknown) => error);
    expect(first).toBeInstanceOf(BadRequestException);
    const firstException = first as BadRequestException;

    expect(repo.rows[0]).toMatchObject({
      status: IdempotencyKeyStatus.COMPLETED,
      responseStatus: 400,
      responseBody: firstException.getResponse(),
    });

    const replay = await interceptor
      .intercept(context, next)
      .catch((error: unknown) => error);
    expect(replay).toBeInstanceOf(HttpException);
    const replayException = replay as HttpException;
    expect(replayException.getStatus()).toBe(400);
    expect(replayException.getResponse()).toEqual(firstException.getResponse());
    expect(next.handle).toHaveBeenCalledTimes(1);
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
      callerId: DEFAULT_BUCKET,
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
      callerId: DEFAULT_BUCKET,
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

  describe('caller scoping for anonymous requests (#799)', () => {
    it('does not replay another anonymous caller\'s cached response for the same key', async () => {
      const callerA = createContext({
        headers: { 'idempotency-key': KEY_A },
        ip: DEFAULT_IP,
      });
      const callerB = createContext({
        headers: { 'idempotency-key': KEY_A },
        ip: OTHER_IP,
      });
      const next = createNext(() => of({ owner: 'A' }));
      await lastValueFrom(await interceptor.intercept(callerA, next));

      const nextB = createNext(() => of({ owner: 'B' }));
      const result = await lastValueFrom(
        await interceptor.intercept(callerB, nextB),
      );

      expect(result).toEqual({ owner: 'B' });
      expect(nextB.handle).toHaveBeenCalledTimes(1);
      expect(repo.rows.map((r) => r.callerId).sort()).toEqual(
        [DEFAULT_BUCKET, `ip:${OTHER_IP}`].sort(),
      );
    });

    it('does not let another anonymous caller\'s PROCESSING lock block a request with the same key', async () => {
      const callerA = createContext({
        headers: { 'idempotency-key': KEY_A },
        ip: DEFAULT_IP,
      });
      const callerB = createContext({
        headers: { 'idempotency-key': KEY_A },
        ip: OTHER_IP,
      });
      // Caller A has claimed the key and its handler never completes, so its
      // PROCESSING row stays fresh. Claiming happens inside intercept(), so
      // the row exists once the promise resolves.
      await interceptor.intercept(callerA, createNext(() => NEVER));

      const nextB = createNext(() => of({ owner: 'B' }));
      const result = await lastValueFrom(
        await interceptor.intercept(callerB, nextB),
      );

      expect(result).toEqual({ owner: 'B' });
      expect(nextB.handle).toHaveBeenCalledTimes(1);
    });

    it('still replays the cached response for the same anonymous caller (same IP)', async () => {
      const context = createContext({
        headers: { 'idempotency-key': KEY_A },
        ip: DEFAULT_IP,
      });
      const first = createNext(() => of({ owner: 'A' }));
      await lastValueFrom(await interceptor.intercept(context, first));

      const retry = createNext(() => of({ owner: 'SHOULD-NOT-RUN' }));
      const result = await lastValueFrom(
        await interceptor.intercept(context, retry),
      );

      expect(result).toEqual({ owner: 'A' });
      expect(retry.handle).not.toHaveBeenCalled();
    });

    it('rejects a request with neither a user nor a client IP instead of using a shared bucket', async () => {
      const context = createContext({
        headers: { 'idempotency-key': KEY_A },
        ip: undefined,
      });
      // createContext defaults an undefined ip to DEFAULT_IP; strip it here.
      (context.switchToHttp().getRequest() as { ip?: string }).ip = undefined;
      const next = createNext(() => of({ ok: true }));

      await expect(interceptor.intercept(context, next)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(next.handle).not.toHaveBeenCalled();
      expect(repo.rows).toHaveLength(0);
    });
  });

  describe('request fingerprint (#54)', () => {
    it('replays correctly when the retried request has identical params and body', async () => {
      const next = createNext(() => of({ id: 'escrow-A', status: 'released' }));
      const context = createContext({
        headers: { 'idempotency-key': KEY_A },
        params: { id: 'escrow-A' },
        body: { recipientAddress: 'GADDRESSA' },
      });

      await lastValueFrom(await interceptor.intercept(context, next));
      const secondResult = await lastValueFrom(
        await interceptor.intercept(context, next),
      );

      expect(secondResult).toEqual({ id: 'escrow-A', status: 'released' });
      expect(next.handle).toHaveBeenCalledTimes(1);
    });

    it('rejects reusing a key across two different resources on the same scope instead of replaying the first (#54)', async () => {
      const contextA = createContext({
        headers: { 'idempotency-key': KEY_A },
        params: { id: 'escrow-A' },
        body: { recipientAddress: 'GADDRESSA' },
      });
      const contextB = createContext({
        headers: { 'idempotency-key': KEY_A }, // same key
        params: { id: 'escrow-B' }, // different resource
        body: { recipientAddress: 'GADDRESSB' },
      });

      const nextA = createNext(() => of({ id: 'escrow-A', released: true }));
      await lastValueFrom(await interceptor.intercept(contextA, nextA));

      const nextB = createNext(() => of({ id: 'escrow-B', released: true }));
      await expect(
        interceptor.intercept(contextB, nextB),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      // The second (different) resource's handler must never run — this is
      // exactly the "escrow B was never actually released" failure mode.
      expect(nextB.handle).not.toHaveBeenCalled();
      expect(repo.rows).toHaveLength(1);
      expect(repo.rows[0].responseBody).toEqual({
        id: 'escrow-A',
        released: true,
      });
    });

    it('rejects reusing a key with the same resource but a different body', async () => {
      const contextFirst = createContext({
        headers: { 'idempotency-key': KEY_A },
        params: { id: 'escrow-A' },
        body: { recipientAddress: 'GADDRESSA' },
      });
      const contextDifferentBody = createContext({
        headers: { 'idempotency-key': KEY_A },
        params: { id: 'escrow-A' },
        body: { recipientAddress: 'GADDRESSC' }, // different recipient
      });

      const next = createNext(() => of({ ok: true }));
      await lastValueFrom(await interceptor.intercept(contextFirst, next));

      await expect(
        interceptor.intercept(contextDifferentBody, next),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(next.handle).toHaveBeenCalledTimes(1);
    });

    it('does not reject a pre-#54 row with no stored fingerprint, even if the incoming fingerprint differs', async () => {
      // Simulates a row created before this migration/column existed.
      await repo.insert({
        key: KEY_A,
        scope: 'test.scope',
        callerId: DEFAULT_BUCKET,
        expiresAt: new Date(Date.now() + 60_000),
      });
      repo.rows[0].status = IdempotencyKeyStatus.COMPLETED;
      repo.rows[0].responseStatus = 200;
      repo.rows[0].responseBody = { legacy: true };
      expect(repo.rows[0].requestFingerprint).toBeNull();

      const context = createContext({
        headers: { 'idempotency-key': KEY_A },
        params: { id: 'escrow-A' },
        body: { recipientAddress: 'GADDRESSA' },
      });
      const next = createNext(() => of({ ok: true }));

      const result = await lastValueFrom(
        await interceptor.intercept(context, next),
      );

      expect(result).toEqual({ legacy: true });
      expect(next.handle).not.toHaveBeenCalled();
    });
  });

  describe('request method and route in the fingerprint (#805)', () => {
    it('rejects reusing a key on the same scope and params when the HTTP method differs', async () => {
      const post = createContext({
        headers: { 'idempotency-key': KEY_A },
        method: 'POST',
        params: { id: 'bounty-1' },
        body: {},
      });
      const del = createContext({
        headers: { 'idempotency-key': KEY_A },
        method: 'DELETE',
        params: { id: 'bounty-1' },
        body: {},
      });

      const nextPost = createNext(() => of({ claimed: true }));
      await lastValueFrom(await interceptor.intercept(post, nextPost));

      const nextDelete = createNext(() => of({ deleted: true }));
      await expect(
        interceptor.intercept(del, nextDelete),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(nextDelete.handle).not.toHaveBeenCalled();
    });

    it('rejects reusing a key on the same scope and params when the route path differs', async () => {
      const release = createContext({
        headers: { 'idempotency-key': KEY_A },
        route: { path: '/escrow/:id/release' },
        params: { id: 'escrow-1' },
        body: {},
      });
      const splitRelease = createContext({
        headers: { 'idempotency-key': KEY_A },
        route: { path: '/escrow/:id/split-release' },
        params: { id: 'escrow-1' },
        body: {},
      });

      const nextRelease = createNext(() => of({ released: true }));
      await lastValueFrom(await interceptor.intercept(release, nextRelease));

      const nextSplit = createNext(() => of({ split: true }));
      await expect(
        interceptor.intercept(splitRelease, nextSplit),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(nextSplit.handle).not.toHaveBeenCalled();
    });
  });

  describe('when the row was already completed by another request (#806)', () => {
    it('does not overwrite a COMPLETED outcome recorded by another request', async () => {
      const next = createNext(() => {
        // Another request reclaims the stale row and completes it while this
        // handler is still running.
        const row = repo.rows[0];
        row.status = IdempotencyKeyStatus.COMPLETED;
        row.responseStatus = 201;
        row.responseBody = { owner: 'other-request' };
        return of({ owner: 'this-request' });
      });
      const context = createContext({
        headers: { 'idempotency-key': KEY_A },
        params: { id: 'bounty-1' },
        body: {},
      });

      await lastValueFrom(await interceptor.intercept(context, next));

      expect(repo.rows).toHaveLength(1);
      expect(repo.rows[0].responseStatus).toBe(201);
      expect(repo.rows[0].responseBody).toEqual({ owner: 'other-request' });
    });
  });

  describe('when recording the COMPLETED outcome fails (#546)', () => {
    it('retries the write and still caches the result', async () => {
      const realUpdate = repo.update.bind(repo);
      jest
        .spyOn(repo, 'update')
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockImplementation(realUpdate);
      const next = createNext(() => of({ id: 'payment-1' }));
      const context = createContext({ headers: { 'idempotency-key': KEY_A } });

      const result = await lastValueFrom(
        await interceptor.intercept(context, next),
      );

      expect(result).toEqual({ id: 'payment-1' });
      expect(repo.rows[0].status).toBe(IdempotencyKeyStatus.COMPLETED);
    });

    it('returns the success, keeps the key, and a retry is rejected instead of re-executing', async () => {
      jest.spyOn(repo, 'update').mockRejectedValue(new Error('pool exhausted'));
      const deleteSpy = jest.spyOn(repo, 'delete');
      const next = createNext(() => of({ id: 'payment-1' }));
      const context = createContext({ headers: { 'idempotency-key': KEY_A } });

      // The handler (money movement) succeeded, so the client gets its result.
      const result = await lastValueFrom(
        await interceptor.intercept(context, next),
      );
      expect(result).toEqual({ id: 'payment-1' });

      // The key is not deleted: it stays PROCESSING.
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(repo.rows).toHaveLength(1);
      expect(repo.rows[0].status).toBe(IdempotencyKeyStatus.PROCESSING);

      // A retry with the same key gets 409 and the handler does not run again.
      await expect(
        interceptor.intercept(
          createContext({ headers: { 'idempotency-key': KEY_A } }),
          next,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(next.handle).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── Invariant: staleness window vs. poll ceiling (#810) ─────────────────────
//
// STALE_PROCESSING_MS must always comfortably exceed the worst-case poll
// ceiling so that a legitimately slow (but not crashed) handler is never
// reclaimed by a concurrent retry.  The minimum safe multiple is 2× — 1×
// leaves no room for RPC latency on top of the poll loop itself.
//
// This test pins the relationship so that tuning SOROBAN_TX_TIMEOUT_SECONDS
// never silently narrows the window below the safety threshold (#810).
describe('STALE_PROCESSING_MS / POLL_CEILING_MS invariant (#810)', () => {
  it('STALE_PROCESSING_MS is at least 2× the poll ceiling', () => {
    expect(STALE_PROCESSING_MS).toBeGreaterThanOrEqual(POLL_CEILING_MS * 2);
  });

  it('POLL_CEILING_MS covers the full transaction timeout plus one poll interval', () => {
    // The poll loop runs POLL_ATTEMPTS × POLL_DELAY_MS.  POLL_ATTEMPTS is
    // ceil(TIMEOUT_MS / POLL_DELAY_MS) + 1, so POLL_CEILING_MS must be
    // strictly greater than SOROBAN_TX_TIMEOUT_SECONDS × 1000.
    const { SOROBAN_TX_TIMEOUT_SECONDS } = jest.requireActual<typeof import('../../escrow/soroban-client.service')>(
      '../../escrow/soroban-client.service',
    );
    expect(POLL_CEILING_MS).toBeGreaterThan(SOROBAN_TX_TIMEOUT_SECONDS * 1000);
  });
});
