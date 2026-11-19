## What this PR does

<!-- A clear, concise summary of the change. -->

## Closes

<!-- List the issue(s) this PR closes. Use "Closes #123" for each. -->

Closes #

## What changed

<!-- Bullet-point list of concrete changes. -->

-

## How to test

<!-- Steps a reviewer should follow to verify the change works. -->

1.
2.
3.

## Checklist

- [ ] `npm run lint` passes locally
- [ ] `npm run build` passes locally
- [ ] `npm test` passes locally
- [ ] `npm run test:e2e` passes locally (needs Postgres — see README "Running Tests")
- [ ] New behaviour has a spec, and a fixed bug has a regression test
- [ ] A new environment variable is documented in `.env.example`
- [ ] A schema change ships with a migration (`npm run migration:generate`)

### Money path

<!-- Tick or delete. Required when touching escrow, payouts, bounties,
     milestones, maintenance pools, teams or idempotency. -->

- [ ] New money-moving routes are `@Idempotent()` and guarded by `RolesGuard`
- [ ] The module spec (`*.module.spec.ts`) still covers the providers and
      repositories this change relies on
- [ ] Behaviour is correct in dry-run mode *and* against a configured contract
      (see README "Dry-run mode")
