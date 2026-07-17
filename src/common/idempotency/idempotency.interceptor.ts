import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm';
import { IdempotencyKey, JsonValue } from '../entities/idempotency-key.entity';
import { IdempotencyKeyStatus } from '../enums';
import { IDEMPOTENCY_SCOPE_KEY } from './idempotent.decorator';

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
 * A PROCESSING row older than this is treated as abandoned (the process
 * handling it almost certainly crashed rather than being merely slow) and
 * is reclaimed by the next request instead of permanently 409-ing.
 */
const STALE_PROCESSING_MS = 30 * 1000;

/** Postgres SQLSTATE for unique_violation. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  const driverError = (error as { driverError?: { code?: string } } | null)
    ?.driverError;
  return driverError?.code === PG_UNIQUE_VIOLATION;
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
 * Caller scoping: none of the controllers this guards (bounties, escrow,
 * milestones, maintenance-pool) currently sit behind JwtAuthGuard, so there
 * is no authenticated caller to scope by yet. `resolveCallerId` falls back
 * to a shared 'anonymous' bucket per scope in that case — see its doc
 * comment for what that does and doesn't protect against.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
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

    const cached = await this.claim(identity);
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
        from(
          this.complete(identity, {
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
   * Determines the bucket a key is scoped to. `req.user.userId` is used
   * when the route is authenticated (none of the current target routes
   * are — see class doc comment). The 'anonymous' fallback still gives
   * correct duplicate-suppression and concurrency-safety for a single
   * client retrying its own request, since that's driven entirely by the
   * (key, scope, callerId) uniqueness, not by callerId being a *real*
   * per-user identity — it just means two different anonymous callers
   * *could* collide if they both independently generated the same UUID
   * for the same scope, which is the accepted, documented trade-off until
   * these routes require auth.
   */
  private resolveCallerId(request: Request): string {
    const user = (request as Request & { user?: { userId?: string } }).user;
    return user?.userId ?? 'anonymous';
  }

  /**
   * Returns a cached outcome to replay, or null if this call has become
   * the owner of the key and should proceed with the real handler.
   * Throws ConflictException (409) if another request currently owns it.
   */
  private async claim(identity: KeyIdentity): Promise<CachedOutcome | null> {
    const existing = await this.repo.findOneBy(identity);
    if (existing) {
      return this.resolveExisting(existing, identity);
    }

    try {
      await this.repo.insert({
        ...identity,
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
      return this.resolveExisting(winner, identity);
    }
  }

  private async resolveExisting(
    existing: IdempotencyKey,
    identity: KeyIdentity,
  ): Promise<CachedOutcome | null> {
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
    return this.resolveExisting(current, identity);
  }

  private async complete(
    identity: KeyIdentity,
    outcome: CachedOutcome,
  ): Promise<void> {
    await this.repo.update(identity, {
      status: IdempotencyKeyStatus.COMPLETED,
      responseStatus: outcome.responseStatus,
      responseBody: outcome.responseBody,
    } as QueryDeepPartialEntity<IdempotencyKey>);
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
