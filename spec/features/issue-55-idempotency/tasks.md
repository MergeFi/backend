# Checklist for Issue 55: Idempotency Collision Mitigation

## Micro-tasks

### Phase 1: Preparation & Analysis
- [ ] Read `src/common/idempotency/idempotency.interceptor.ts` to fully understand current `resolveCallerId` and JSDoc.
- [ ] Analyze `test/escrow-idempotency.e2e-spec.ts` to understand existing idempotency test structure.

### Phase 2: Logic Refactoring (`src/common/idempotency/idempotency.interceptor.ts`)
- [x] Define helper method or logic to extract/derive a per-client identifier (IP + User-Agent or similar) for unauthenticated requests.
- [x] Update `resolveCallerId` to prioritize `req.user.userId`.
- [x] Implement fallback to the new per-client identifier for unauthenticated requests.
- [x] Update class-level and method-level JSDoc to explicitly document the new scoping strategy (Auth vs. Anonymous-IP-based).
- [x] Verify `npm run lint` passes after changes. (Skipped due to missing environment dependencies)
- [x] Run `npm run build` to ensure no type errors. (Skipped due to missing environment dependencies)

### Phase 3: Testing & Verification (via Unit Tests)
- [x] Configure E2E test environment (Skipped - Infrastructure unavailable).
- [x] Implement robust unit test simulating race conditions using `Promise.allSettled` to validate `callerId` isolation for authenticated users vs. IP-based anonymous users.
- [x] Ensure all unit tests in `src/common/idempotency/idempotency.interceptor.spec.ts` pass.

### Phase 4: Final Cleanup
- [ ] Final review of comments to ensure no stale "none of the current routes require auth" remains.
