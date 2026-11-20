import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm';
import { IdempotencyKey, JsonValue } from '../entities/idempotency-key.entity';
import { IdempotencyKeyStatus } from '../enums';
import { IDEMPOTENCY_SCOPE_KEY } from './idempotent.decorator';
import { POLL_CEILING_MS } from '../../escrow/soroban-client.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How long a completed key's cached response stays replayable for. Chosen
 * to comfortably outlast any plausible client retry/backoff window without
 * keeping rows around indefinitely; actual deletion is performed by
 * IdempotencyCleanupService's sweep once `expiresAt` passes.
 */
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Safety multiplier applied to `POLL_CEILING_MS` when computing
 * `STALE_PROCESSING_MS`. The ceiling includes bounded transaction resubmission
 * polls and queue-full delays; 3× leaves headroom for RPC round-trips (#810).
 *
 * Raising SOROBAN_TX_TIMEOUT_SECONDS (e.g. for congestion) automatically
 * raises POLL_CEILING_MS and therefore this window, keeping the invariant
 * STALE_PROCESSING_MS >= POLL_CEILING_MS * 2 intact without manual edits.
 */
const STALE_PROCESSING_SAFETY_FACTOR = 3;

/**
 * A PROCESSING row older than this is treated as abandoned (the process
 * handling it almost certainly crashed rather than being merely slow) and
 * is reclaimed by the next request instead of permanently 409-ing.
 *
 * Must comfortably outlast the slowest legitimate handler: the escrow
 * mutations this interceptor guards go through
 * SorobanClientService.invoke polls for the transaction's full time bound
 * and may rebuild/resubmit at a higher fee before returning (#527). A 30s
 * window was shorter than that worst case, letting a client retry reclaim a
 * row whose original request was still active and re-execute a money-moving
 * operation (#90).
 *
 * Derived from POLL_CEILING_MS × STALE_PROCESSING_SAFETY_FACTOR instead of
 * a hardcoded constant so that tuning SOROBAN_TX_TIMEOUT_SECONDS
 * automatically propagates here and CI can assert the invariant (#810).
 */
export const STALE_PROCESSING_MS = POLL_CEILING_MS * STALE_PROCESSING_SAFETY_FACTOR;

/** Postgres SQLSTATE for unique_violation. */
const PG_UNIQUE_VIOLATION = '23505';

/** Attempts to record a successful outcome before giving up (#546). */
const COMPLETE_WRITE_ATTEMPTS = 2;

function isUniqueViolation(error: unknown): boolean {
  const driverError = (error as { driverError?: { code?: string } } | null)
    ?.driverError;
  return driverError?.code === PG_UNIQUE_VIOLATION;
}

/**
 * Deterministic JSON serialization with object keys sorted recursively, so
 * two logically-identical bodies that merely arrived with different key
 * order (a real possibility across HTTP clients/serializers, including a
 * client's own legitimate retry) hash identically rather than being
 * mistaken for a mismatch.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Fingerprints "what request is this" — HTTP method, route path, path params
 * plus body — so it can be bound to an idempotency key's identity alongside
 * (key, scope, callerId) (#54, #805). Method and route make the fingerprint
 * self-describing, so a scope string shared by two routes cannot replay one
 * route's response for the other. Query params are deliberately excluded:
 * none of the routes this guards read identity-relevant data from the query
 * string.
 */
function computeRequestFingerprint(request: Request): string {
  const payload = stableStringify({
    method: request.method,
    path: request.route?.path ?? request.path,
    params: request.params ?? {},
    body: (request.body as Record<string, unknown> | undefined) ?? {},
  });
  return createHash('sha256').update(payload).digest('hex');
}

interface KeyIdentity {
  key: string;
  scope: string;
  callerId: string;
}

interface CachedOutcome {
  responseStatus: number;
  responseBody: JsonValue;
}

/**
 * Backs the `@Idempotent(scope)` decorator (#16).
 *
 * The safety property this provides — two concurrent requests carrying the
 * same Idempotency-Key/scope/caller never both execute the underlying
 * mutation — comes entirely from `idempotency_keys`' unique index on
 * (key, scope, callerId), not from anything in this class. `claim()` always
 * *attempts* a plain `insert()` and reacts to a unique-violation rather than
 * checking-then-inserting, because a JS-level "does a row exist?" check
 * followed by a separate insert has the same TOCTOU gap the issue warns
 * about — the database constraint is what actually closes it.
 *
 * Response caching policy: a 2xx or 4xx outcome is a definite, deterministic
 * result of the request, so it's cached and replayed verbatim on retry. A
 * 5xx (or any non-HttpException failure) is *not* cached — the key is
 * released instead — because forcing every future retry to replay a server
 * error forever is worse than letting the retry try again cleanly.
 *
 * Caller scoping: keys are bucketed per caller, never in one shared bucket.
 * An authenticated request (req.user set by JwtAuthGuard) is bucketed by its
 * userId; an anonymous one by its client IP (`ip:<address>`). A request with
 * neither is rejected rather than falling back to a shared constant. See
 * `resolveCallerId` for the rule and its limits.
 *
 * Empty-body caveat: the fingerprint check (below) hashes path params plus
 * body. When the body is empty (e.g. POST /bounties/:id/claim, which the
 * frontend sends as `{}`), the fingerprint only binds the path params, so the
 * fingerprint check is effectively vacuous for body-less routes. Caller
 * scoping is what keeps one caller's key from replaying another's response.
 *
 * Request identity: `scope` is a static string per route (e.g.
 * 'escrow.release'), the same for every request to that route regardless
 * of path params or body — so (key, scope, callerId) alone can't tell two
 * different resources (or two different payloads) apart. `resolveExisting`
 * additionally compares a SHA-256 fingerprint of path params + body
 * (`computeRequestFingerprint`) against the fingerprint stored on the
 * existing row, and rejects with 422 on a mismatch rather than replaying
 * the wrong cached response (#54). This binds identity via the body-hash
 * comparison rather than folding path params into `scope` itself — scope
 * stays a purely route-level concept (matches its existing "unique per
 * scope, not globally" contract), and one mechanism covers both path
 * params and body instead of two.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const scope = this.reflector.get<string | undefined>(
      IDEMPOTENCY_SCOPE_KEY,
      context.getHandler(),
    );
    if (!scope) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const rawKey = request.headers['idempotency-key'];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (!key || !UUID_PATTERN.test(key)) {
      throw new BadRequestException(
        'A valid Idempotency-Key header (UUID) is required for this request',
      );
    }

    const identity: KeyIdentity = {
      key,
      scope,
      callerId: this.resolveCallerId(request),
    };
    const fingerprint = computeRequestFingerprint(request);

    const cached = await this.claim(identity, fingerprint);
    if (cached) {
      const badRequestStatus: number = HttpStatus.BAD_REQUEST;
      if (cached.responseStatus >= badRequestStatus) {
        throw new HttpException(
          cached.responseBody as string | Record<string, unknown>,
          cached.responseStatus,
        );
      }
      return of(cached.responseBody);
    }

    // Mirrors Nest's own status resolution (explicit @HttpCode(), else 201
    // for POST / 200 otherwise) purely so the cached row records the status
    // the caller actually saw — it doesn't influence what Nest sends now,
    // since that's independently recomputed by Nest from the same route
    // metadata on every request, replay or not.
    const httpStatusCode =
      this.reflector.get<number | undefined>(
        HTTP_CODE_METADATA,
        context.getHandler(),
      ) ?? (request.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);

    return next.handle().pipe(
      mergeMap((data: unknown) =>
        // completeAfterSuccess never rejects: once the handler has succeeded
        // (funds may already have moved on-chain), a failed bookkeeping write
        // must not reach catchError → settleFailure, which would delete the
        // key and let a retry run the operation again (#321, #546).
        from(
          this.completeAfterSuccess(identity, {
            responseStatus: httpStatusCode,
            responseBody: (data ?? null) as JsonValue,
          }),
        ).pipe(map(() => data)),
      ),
      catchError((error: unknown) =>
        from(this.settleFailure(identity, error)).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  /**
   * Determines the bucket a key is scoped to (#799).
   *
   * - Authenticated (JwtAuthGuard set req.user): the userId. JWT userIds are
   *   UUIDs, so they never carry the `ip:` prefix.
   * - Anonymous: `ip:<request.ip>`. This is per-client, so two anonymous
   *   callers presenting the same key do not share a cached response or a
   *   PROCESSING lock.
   * - Neither available: throws. Falling back to a shared constant is what
   *   let one caller's key block or replay another's.
   *
   * request.ip is the socket peer address unless Express `trust proxy` is set.
   * Behind a reverse proxy without it, every anonymous caller shares the
   * proxy's address, so the anonymous bucket degrades to one bucket per proxy
   * IP. No trust-proxy setting was found in src/main.ts.
   *
   * Changing the bucket does not affect rows already stored under the old
   * 'anonymous' callerId. Those expire under the 24h TTL, and a retry of one
   * of those keys after deploy starts a new bucket.
   */
  private resolveCallerId(request: Request): string {
    const user = (request as Request & { user?: { userId?: string } }).user;
    if (user?.userId) {
      return user.userId;
    }
    const ip = request.ip;
    if (!ip) {
      throw new BadRequestException(
        'Unable to identify the caller for this Idempotency-Key',
      );
    }
    return `ip:${ip}`;
  }

  /**
   * Returns a cached outcome to replay, or null if this call has become
   * the owner of the key and should proceed with the real handler.
   * Throws ConflictException (409) if another request currently owns it,
   * or UnprocessableEntityException (422) if it's owned by a request that
   * targeted a different resource/body under the same key (#54).
   */
  private async claim(
    identity: KeyIdentity,
    fingerprint: string,
  ): Promise<CachedOutcome | null> {
    const existing = await this.repo.findOneBy(identity);
    if (existing) {
      return this.resolveExisting(existing, identity, fingerprint);
    }

    try {
      await this.repo.insert({
        ...identity,
        requestFingerprint: fingerprint,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_KEY_TTL_MS),
      });
      return null;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Lost the insert race — another request became the owner between
      // our findOneBy and our insert. Defer to it exactly as if we'd
      // found it up front.
      const winner = await this.repo.findOneBy(identity);
      if (!winner) {
        // The winner's row is already gone (e.g. it failed with a 5xx and
        // was released in the instant between our failed insert and this
        // read) — safe to treat this as a fresh attempt.
        return null;
      }
      return this.resolveExisting(winner, identity, fingerprint);
    }
  }

  private async resolveExisting(
    existing: IdempotencyKey,
    identity: KeyIdentity,
    fingerprint: string,
  ): Promise<CachedOutcome | null> {
    // A null stored fingerprint means this row predates the column
    // (migration deploy transition) — nothing to compare against, so it's
    // exempt rather than treated as a guaranteed mismatch. Checked before
    // status/staleness: a fingerprint mismatch means this was never "the
    // same operation" in the first place, regardless of what state the
    // true owner's row is in.
    if (
      existing.requestFingerprint !== null &&
      existing.requestFingerprint !== fingerprint
    ) {
      throw new UnprocessableEntityException(
        'This Idempotency-Key has already been used with a different request (different resource or body). Use a new Idempotency-Key for a different operation.',
      );
    }

    if (existing.status === IdempotencyKeyStatus.COMPLETED) {
      return {
        responseStatus: existing.responseStatus ?? HttpStatus.OK,
        responseBody: existing.responseBody,
      };
    }

    const ageMs = Date.now() - existing.updatedAt.getTime();
    if (ageMs < STALE_PROCESSING_MS) {
      throw new ConflictException(
        'A request with this Idempotency-Key is already being processed',
      );
    }

    // Reclaim a stale PROCESSING row: conditioning the UPDATE on both the
    // id *and* the exact `updatedAt` we observed makes this an atomic
    // compare-and-swap, so if two retries race to reclaim the same stale
    // row, only one UPDATE matches and wins.
    const reclaim = await this.repo.update(
      {
        id: existing.id,
        status: IdempotencyKeyStatus.PROCESSING,
        updatedAt: existing.updatedAt,
      },
      { updatedAt: new Date() },
    );

    if ((reclaim.affected ?? 0) > 0) {
      return null;
    }

    // Someone else reclaimed or completed it first — read back the current
    // state and defer to it rather than assuming.
    const current = await this.repo.findOneBy(identity);
    if (!current) {
      return null;
    }
    return this.resolveExisting(current, identity, fingerprint);
  }

  /**
   * Records a successful handler outcome. Retries the write once; if it still
   * fails, logs and leaves the row PROCESSING. A retry with the same key then
   * gets 409 until the row goes stale instead of re-executing, and this
   * request still returns the handler's real response (#546).
   */
  private async completeAfterSuccess(
    identity: KeyIdentity,
    outcome: CachedOutcome,
  ): Promise<void> {
    for (let attempt = 1; attempt <= COMPLETE_WRITE_ATTEMPTS; attempt++) {
      try {
        await this.complete(identity, outcome);
        return;
      } catch (error) {
        if (attempt === COMPLETE_WRITE_ATTEMPTS) {
          this.logger.error(
            `Handler succeeded but recording the COMPLETED idempotency key failed ` +
              `(scope=${identity.scope}); keeping it PROCESSING so a retry is rejected ` +
              `rather than re-executed`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    }
  }

  private async complete(
    identity: KeyIdentity,
    outcome: CachedOutcome,
  ): Promise<void> {
    // Compare-and-swap on PROCESSING: if another request has already
    // completed this row (it reclaimed the row after this request went
    // stale), leave that outcome alone rather than overwrite it (#806).
    const result = await this.repo.update(
      { ...identity, status: IdempotencyKeyStatus.PROCESSING },
      {
        status: IdempotencyKeyStatus.COMPLETED,
        responseStatus: outcome.responseStatus,
        responseBody: outcome.responseBody,
      } as QueryDeepPartialEntity<IdempotencyKey>,
    );
    if ((result.affected ?? 0) === 0) {
      this.logger.warn(
        `Idempotency key was no longer PROCESSING when recording the outcome ` +
          `(scope=${identity.scope}); keeping the outcome already recorded`,
      );
    }
  }

  private async settleFailure(
    identity: KeyIdentity,
    error: unknown,
  ): Promise<void> {
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const internalServerErrorStatus: number =
        HttpStatus.INTERNAL_SERVER_ERROR;
      if (status < internalServerErrorStatus) {
        await this.repo.update(identity, {
          status: IdempotencyKeyStatus.COMPLETED,
          responseStatus: status,
          responseBody: error.getResponse(),
        });
        return;
      }
    }

    // Not a safe, deterministic outcome to force every future retry to
    // replay — release the key so the next attempt re-executes cleanly.
    await this.repo.delete(identity);
  }
}
