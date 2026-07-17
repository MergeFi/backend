import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { IdempotencyInterceptor } from './idempotency.interceptor';

export const IDEMPOTENCY_SCOPE_KEY = 'idempotency:scope';

/**
 * Marks a mutation endpoint as requiring an `Idempotency-Key` header and
 * guards it with IdempotencyInterceptor (#16).
 *
 * `scope` namespaces keys per endpoint (e.g. 'bounty.fund') — the same key
 * value reused across two different scopes is treated as two unrelated
 * requests, since a client legitimately reusing a UUID generator's output
 * across different calls shouldn't collide.
 */
export function Idempotent(scope: string) {
  return applyDecorators(
    SetMetadata(IDEMPOTENCY_SCOPE_KEY, scope),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description:
        'Client-supplied UUID identifying this request. Retrying the same request (same key, same endpoint, same caller) after a network failure returns the original response instead of re-executing the mutation. A concurrent request reusing an in-flight key receives 409 Conflict. Cached outcomes are retained for a limited time — see the API README/docs for the current TTL.',
      schema: { type: 'string', format: 'uuid' },
    }),
  );
}
