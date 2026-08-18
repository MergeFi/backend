## Overview

`IdempotencyInterceptor` scopes cached responses by caller so one client's retries don't collide with another's — but since none of the routes it guards currently require authentication (see the companion "no auth at all" issue), every unauthenticated caller falls into the exact same bucket:

```ts
// src/common/idempotency/idempotency.interceptor.ts:161-176
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
```

The comment frames the risk as "two different anonymous callers *could* collide if they both independently generated the same UUID" — implying this needs bad luck or coincidence. It doesn't. Since `Idempotency-Key` is a value the *client* chooses and sends as a plain header, nothing stops a second, adversarial client from simply **reading or guessing** a key value in flight and deliberately reusing it — there's no secrecy or unpredictability requirement on the header at all, and every caller today shares one `'anonymous'` bucket per scope, so any two callers who end up using the same key value for the same route (accidentally, because a key wasn't as random as intended, or deliberately, because an attacker is targeting this specific gap) collide in the exact same `(key, scope, callerId)` row.

Combine this with the `claim()`/`resolveExisting()` race-handling logic, which is otherwise correctly built:

```ts
// src/common/idempotency/idempotency.interceptor.ts:224-229
const ageMs = Date.now() - existing.updatedAt.getTime();
if (ageMs < STALE_PROCESSING_MS) {
  throw new ConflictException('A request with this Idempotency-Key is already being processed');
}
```

Two concrete, distinct consequences of the shared bucket, both real given today's total absence of auth on these routes:

1. **Denial of service via collision.** Attacker sends a request to `POST /bounties/:id/claim` with `Idempotency-Key: K` for a bounty they have no relationship to, timed to land while a legitimate user is mid-flight on their *own*, unrelated request that happens to reuse `K` (or the attacker simply front-runs with `K` first) — the legitimate user's request now collides with the attacker's `PROCESSING` row and gets a `409 Conflict` for up to `STALE_PROCESSING_MS` (30s), or worse if the attacker's request never completes (crashes/hangs before ever transitioning out of `PROCESSING`), for exactly `STALE_PROCESSING_MS` before it's reclaimed.
2. **Response confusion.** If the attacker's colliding request completes *first* (any outcome, success or failure) and the legitimate user's identical-key request arrives after, the legitimate user receives the **attacker's cached response** — a caller trying to claim bounty B could receive a cached "success" response that actually describes the attacker's unrelated claim on bounty A (compounding directly with the companion "idempotency key not bound to resource/body" issue — this issue is about *whose* bucket the collision happens in, that one is about *what the key represents* once it's in a bucket; both need fixing, and either alone leaves a real gap).

## Requirements

- The real fix is authentication (the companion "no auth at all" issue) — once every guarded route requires a valid JWT, `resolveCallerId` naturally scopes by real `req.user.userId` and this collision surface closes for authenticated callers. This issue tracks that `resolveCallerId`'s fallback and doc comment are updated in lockstep with that fix landing, not left stale.
- Until (or unless) auth lands for a given route, consider whether a *weaker* per-client scoping signal is better than one shared global bucket — e.g. binding to some combination of source IP and a client-generated session token, acknowledging this is still spoofable but meaningfully narrows the blast radius versus one bucket for the entire internet.
- Update the class-level and method-level doc comments once the underlying assumption ("none of the current target routes are [authenticated]") is no longer true for some or all of the guarded routes, so the code doesn't keep describing a trade-off that no longer applies to the routes that have moved past it.
- Add a test demonstrating the collision directly: two distinct "callers" (no auth, so indistinguishable) racing the same Idempotency-Key on the same scope but semantically different requests, and assert (post-auth-fix) that authenticated callers no longer share a bucket.

## Acceptance Criteria

- [ ] Once JWT auth lands on the guarded routes (per the companion issue), `resolveCallerId` scopes by the real authenticated user, verified by a test that two different authenticated users reusing the same Idempotency-Key value do **not** collide.
- [ ] `IdempotencyInterceptor`'s doc comments are updated to reflect the new state, not left describing a trade-off for routes that no longer need it.
- [ ] For any route that remains unauthenticated by deliberate design (if any), the collision risk is explicitly documented as an accepted trade-off for that specific route, not inherited silently from the class-wide comment.

## Additional Notes

**Precise references:** `src/common/idempotency/idempotency.interceptor.ts:161-176` (`resolveCallerId` and its doc comment, the core of this issue), `:61-84` (class-level doc comment making the same "none of these routes require auth yet" assumption), `:224-246` (`resolveExisting`'s `STALE_PROCESSING_MS` window and reclaim logic — the mechanism a collision, whether accidental or deliberate, interacts with), `src/common/entities/idempotency-key.entity.ts:49-56` (`callerId` column, confirmed to just be a string with no structural guarantee of uniqueness-per-real-caller when unauthenticated).

**Test/reproduction plan:**
```ts
// Simulates two unrelated "anonymous" callers reusing the same key on the same route.
const key = randomUUID();
const p1 = request(app).post('/bounties/bounty-A/claim').set('Idempotency-Key', key).send({ contributorId: userX });
const p2 = request(app).post('/bounties/bounty-B/claim').set('Idempotency-Key', key).send({ contributorId: userY });
const [r1, r2] = await Promise.allSettled([p1, p2]);
// pre-fix (no auth): one of these gets 409, or gets served the other's cached response —
// neither behavior is correct for what are, from the caller's perspective, two totally
// unrelated requests that only accidentally/adversarially share a key value.
```

**Cross-references:** direct corollary of the "no auth at all" issue — this is what leaving that gap unfixed costs the idempotency system specifically, on top of the direct fund-safety costs that issue already describes. Also compounds with the companion "idempotency key not bound to resource/body" issue: that one is exploitable even for a single, honest, authenticated caller who reuses a key by mistake; this one is about multiple unrelated, currently-indistinguishable callers sharing a bucket. Fixing auth closes this issue's specific gap but does not close that one — they need to be tracked and verified independently.
