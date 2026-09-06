# Revised Plan for Idempotency Collision Mitigation (Issue 55)

## Goal
Resolve idempotency key collisions between distinct anonymous callers and strengthen the scoping mechanism in `IdempotencyInterceptor`.

## Affected Components
- `src/common/idempotency/idempotency.interceptor.ts`: Update `resolveCallerId` logic.
- `test/escrow-idempotency.e2e-spec.ts`: Add tests demonstrating collision separation.

## Implementation Steps
1.  **Refactor `resolveCallerId`:**
    - Modify `resolveCallerId` to prioritize `req.user.userId`.
    - Replace the `'anonymous'` fallback with a more specific identifier for unauthenticated requests, such as a combination of `req.ip` and (optionally) a client-provided fingerprint or `User-Agent` to reduce collision surface area.
    - Explicitly document this fallback strategy.
2.  **Update Documentation:**
    - Update class-level and method-level JSDoc in `IdempotencyInterceptor` to clearly distinguish between authenticated (`userId`) and unauthenticated (IP-based) scoping.
    - Remove or update comments stating that no routes require authentication if this changes, or clarify that the fallback is a trade-off for unauthenticated routes.
3.  **Verification:**
    - Implement tests in `test/escrow-idempotency.e2e-spec.ts` that demonstrate:
        - Two distinct authenticated users reusing the same `Idempotency-Key` do *not* collide.
        - Two distinct unauthenticated callers (different IPs) using the same `Idempotency-Key` do *not* collide (or collide less easily than the current global bucket).

## Constraints
- **Scope Restriction:** Do not implement Authentication Guards on routes; this remains the responsibility of a companion issue.
- **Backwards Compatibility:** Ensure the new fallback still provides reliable idempotency for a *single* client retrying its own request.
