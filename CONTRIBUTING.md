# Contributing to the MergeFi backend

Thanks for helping. This repository holds the escrow orchestration, GitHub
OAuth and the payout logic, so the bar for review is higher than for the
frontend or docs. This guide covers what a PR needs to merge.

Found a security problem? **Do not open an issue or PR.** Follow
[SECURITY.md](./SECURITY.md) instead.

## Before you start

- Look for an existing issue, or open one with the matching template
  (bug, feature, missing test), before starting on anything non-trivial.
- Work that spans repositories (an API shape the frontend reads, a contract
  call signature) needs matching issues in
  [MergeFi/frontend](https://github.com/MergeFi/frontend) or
  [MergeFi/contracts](https://github.com/MergeFi/contracts).

## Local setup

The README's [Setup, run, test](./README.md#setup-run-test) section is the
source of truth. In short:

```bash
nvm use                # Node 24, from .nvmrc — npm refuses other majors (engine-strict)
cp .env.example .env
npm ci
docker compose up -d db   # or point DATABASE_URL at your own Postgres 16
npm run start:dev
```

A fresh `.env` runs Soroban in **dry-run mode**: escrow calls are faked and
nothing settles on-chain. Read README ["Dry-run mode"](./README.md#dry-run-mode)
before testing anything payout-related.

## Making a change

**Branches** — `fix/<issue>-<short-desc>`, `feat/...`, `test/...`, `chore/...`.

**Commits** — Conventional Commits with the issue number, matching the
existing history:

```
fix(#810): derive STALE_PROCESSING_MS from POLL_CEILING_MS
test(escrow): cover RECONCILIATION_PENDING (#814)
```

**Tests** — every behaviour change ships with a spec; every bug fix ships
with a regression test that fails without the fix.

- Unit specs live next to the code as `*.spec.ts`.
- Each Nest module has a `*.module.spec.ts` that compiles it with a mocked
  DataSource (see `test/helpers/module-test.helpers.ts`). If you add a
  provider, a repository or a guarded/idempotent route to a module, extend
  that spec.
- Integration specs (`*.integration.spec.ts`) and e2e specs (`test/`) need a
  real Postgres on `DATABASE_URL`.

**Configuration** — every `process.env` read must be documented in
`.env.example`; `src/config/env-example.spec.ts` fails otherwise. A variable
that production cannot run without belongs in
`src/config/validate-required-config.ts`.

**Schema** — entity changes need a migration
(`npm run migration:generate -- src/database/migrations/<Name>`). Do not rely
on `DATABASE_SYNCHRONIZE` outside local development.

### Money-path changes

Changes under `src/escrow`, `src/bounties`, `src/milestones`,
`src/maintenance-pool`, `src/teams` or `src/common/idempotency` get extra
scrutiny:

- Money-moving routes must be `@Idempotent(<scope>)` and guarded with
  `RolesGuard`.
- State transitions and `Payment` rows are written in the same transaction,
  under the escrow row lock (`EscrowService.withLockedEscrow`).
- Verify behaviour in dry-run mode *and* reason about it against a configured
  contract: a dry-run result is a synthetic success, not a test of the chain.

## Opening the PR

Fill in the pull request template. Before requesting review, run:

```bash
npm run lint
npm run build
npm test
npm run test:e2e   # needs Postgres
```

CI runs the same steps plus a full-history gitleaks scan. Paths listed in
[`.github/CODEOWNERS`](./.github/CODEOWNERS) need a code-owner approval.
