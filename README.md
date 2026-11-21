# MergeFi Backend

**Where Open Source Meets Finance.**

MergeFi lets sponsors fund open-source work, lets maintainers attach real money
to GitHub issues, and pays contributors automatically the moment their pull
request is merged. GitHub stays the source of truth for code and review;
Stellar/Soroban smart contracts hold the money in escrow and release it
without anyone having to chase an invoice.

- **Contributors** discover paid issues, build an on-chain-verifiable
  reputation, and get paid in stablecoins (USDC) or XLM the moment their PR
  merges.
- **Maintainers** create projects, attach rewards to issues or whole
  milestones, and approve completed work.
- **Sponsors** fund repos, issues, or milestones, and get a dashboard of
  spend, impact, and contributor performance.

This repository is the backend API. The Soroban smart contracts themselves
live in the sibling repo `mergefi-contracts`; this service is the
orchestration/API layer that talks to those contracts over Stellar/Soroban
RPC and mirrors on-chain state into Postgres for fast reads.

---

## Table of contents

- [Architecture](#architecture)
- [Modules](#modules)
- [Data model](#data-model)
- [Environment variables](#environment-variables)
- [Escrow / Soroban integration](#escrow--soroban-integration)
  - [Dry-run mode](#dry-run-mode)
  - [`ESCROW_DEADLINE_SECONDS` and the permissionless refund window](#escrow_deadline_seconds-and-the-permissionless-refund-window)
- [API overview](#api-overview)
- [Setup, run, test](#setup-run-test)
  - [Node.js version](#nodejs-version)
  - [Dependency overrides](#dependency-overrides)
- [Roadmap](#roadmap)
- [License](#license)

---

## Architecture

```
                     ┌────────────────────┐
                     │   GitHub (REST +   │
                     │   webhooks)        │
                     └─────────┬──────────┘
                     issues/PRs│  ▲ webhook (pull_request)
                                │  │ (HMAC-SHA256 verified)
                                ▼  │
 ┌──────────────────────────────────────────────────────────┐
 │                     MergeFi Backend (NestJS)               │
 │                                                              │
 │  auth ─── users ─── github (sync + webhooks) ─── bounties   │
 │                                        │              │      │
 │                                        │              ▼      │
 │                              teams ◄───┘         escrow      │
 │                                                    │   │     │
 │                              milestones ───────────┘   │     │
 │                              maintenance-pool ──────────┘     │
 │                              sponsors / reputation / analytics│
 │                                                              │
 │                       Postgres (TypeORM)                    │
 └───────────────────────────────┬──────────────────────────────┘
                                  │ Soroban RPC / Horizon
                                  ▼
                   ┌───────────────────────────────┐
                   │  Escrow smart contract(s)      │
                   │  deployed from mergefi-contracts│
                   │  (Stellar / Soroban network)    │
                   └───────────────────────────────┘
```

Design principles:

- **GitHub is the source of truth for code.** We import repos/issues/PRs via
  the REST API (`@octokit/rest`) and keep a local mirror for fast querying,
  refreshed by sync calls and kept current by webhooks.
- **Stellar/Soroban is the source of truth for money.** Every escrow state
  change (fund/release/refund/split) is a real contract invocation through
  `@stellar/stellar-sdk`'s Soroban RPC client; Postgres holds an audit-trail
  mirror (`escrows`, `payments`) of that on-chain activity, not the money
  itself.
- **Config-driven, not hardcoded.** Soroban deployment/signing settings are
  read from env. Missing live configuration fails explicitly; synthetic
  operations require `SOROBAN_DRY_RUN=true` and are recorded as `dry_run` —
  see [Escrow / Soroban integration](#escrow--soroban-integration).

## Modules

| Module | Responsibility |
|---|---|
| `auth` | GitHub OAuth login (`passport-github2`) and JWT session issuance/validation (`passport-jwt`). |
| `users` | User + linked `GithubAccount` records, role management, Stellar address linking. |
| `github` | Repository/issue sync via Octokit (`github-sync.service.ts`) and inbound webhook handling with HMAC-SHA256 signature verification (`github-webhooks.service.ts`, `webhook-signature.util.ts`). On a merged PR, resolves the linked issue → bounty and triggers escrow release. |
| `bounties` | Paid-issue lifecycle: create, fund, claim, review, merge, pay, refund, expire. State machine in `bounty-state-machine.ts`. |
| `escrow` | Orchestrates fund/release/refund against the escrow contract via `SorobanClientService`, and keeps `Escrow`/`Payment` rows in sync. Single-recipient and team-split payouts both go through the contract's one `release(issue_id, recipients)` entrypoint. |
| `teams` | Team bounties: create a team with percentage splits (e.g. frontend 40 / backend 40 / testing 20), assign it to a bounty, validated to sum to 100%. |
| `milestones` | Fund an entire milestone's budget up front; distribute it incrementally as issues resolve (`resolveIssue`), splitting the remaining budget across still-open issues. |
| `maintenance-pool` | Recurring sponsor deposits into a shared pool; maintainers assign rewards out of the running balance for maintenance-type work. |
| `sponsors` | Sponsor dashboard: active bounties, total spend, budget locked in escrow, milestone progress, recent payments. |
| `reputation` | Computes and snapshots per-contributor stats: earnings, merged PR count, completion rate, avg review time, on-time delivery %, languages, orgs. |
| `analytics` | Lifetime earnings, repo/org counts, merge rate, review time, languages, a payout heatmap, and top clients (sponsors) per contributor; a platform-wide summary for the homepage. Contributor stats are SQL `GROUP BY` / `SUM` / `COUNT` (heatmap is UTC calendar days, capped at 366 buckets; top clients `ORDER BY` spend `LIMIT 10`). `GET /analytics/platform` is cached in-process for `ANALYTICS_PLATFORM_SUMMARY_TTL_MS` (default 60s) and invalidated when a bounty is created or paid or a repository is first synced. Multi-instance deploys may serve up to one TTL of stale data per process. |

Cross-cutting: `config` (typed `@nestjs/config` configuration + `.env`),
`common/entities` (all TypeORM entities + enums), Swagger mounted at
`/api/docs`.

## Data model

Entities (`src/common/entities`):

- **User** — platform account; `roles` (contributor/maintainer/sponsor can
  overlap), optional linked `stellarAddress`.
- **GithubAccount** — 1:1 with User; OAuth tokens (never serialized out).
- **Repository** — synced GitHub repo metadata.
- **Issue** — synced GitHub issue; flagged `isMaintenanceType` for pool-eligible work; optionally attached to a **Milestone**.
- **Bounty** — 1:1 with Issue; amount/asset/difficulty/deadline/status, optional **Team** for split payouts, optional 1:1 **Escrow**.
- **Escrow** — local mirror of one on-chain escrow instance (owns the FK to whichever of bounty/milestone/maintenance-pool it backs), contract tx hashes, status.
- **Payment** — one payout leg per escrow release (one row per team-split recipient, or one for a plain release).
- **Team** / **TeamMemberSplit** — named group + percentage splits (must sum to 100).
- **Milestone** — budget + asset for a whole release; tracks `distributed` vs `budget`.
- **MaintenancePool** — recurring balance; `monthlyDeposit`, running `balance`.
- **ReputationSnapshot** — point-in-time computed contributor stats, appended over time.
- **WebhookEvent** — audit log of every inbound GitHub webhook (verified or not), for replay/debugging.

## Environment variables

See [`.env.example`](./.env.example) for the full annotated list. Highlights:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (TypeORM). |
| `DATABASE_SSL` | Enables PostgreSQL TLS; required in production. Certificate verification is enabled by default. |
| `DATABASE_SSL_CA` | Optional PEM CA certificate for PostgreSQL TLS when using a private CA. |
| `DATABASE_SYNCHRONIZE` | Enables TypeORM schema synchronization only in development; production startup refuses `true`. |
| `TRUST_PROXY` | Express proxy trust configuration: `false` by default, a fixed hop count (for example `1` behind one trusted ingress), or a comma-separated trusted address/subnet list. Do not use `true`, which can let clients spoof forwarded IPs. |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Session token signing. |
| `GITHUB_CLIENT_ID` / `_SECRET`, `GITHUB_OAUTH_CALLBACK_URL` | GitHub OAuth login app. The callback defaults to `${APP_URL}/api/auth/github/callback`; `APP_URL` defaults to `http://localhost:${PORT}`. |
| `GITHUB_API_TOKEN` | Token used by Octokit for repo/issue sync (PAT for now; see roadmap). |
| `GITHUB_WEBHOOK_SECRET` | HMAC-SHA256 secret configured on the GitHub webhook. |
| `ANALYTICS_PLATFORM_SUMMARY_TTL_MS` | In-process TTL for `GET /analytics/platform` (default `60000`). Also invalidated on bounty create/pay and first repository sync. |
| `STELLAR_NETWORK`, `SOROBAN_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE` | Stellar network config. |
| `SOROBAN_DRY_RUN` | Explicitly enables synthetic escrow invocations. Defaults to `false`; synthetic escrow/payment rows are marked `dry_run` and excluded from confirmed-payout totals. |
| `ESCROW_CONTRACT_ID` | Deployed escrow contract ID from `mergefi-contracts`; required for live Soroban calls. |
| `MAINTENANCE_POOL_CONTRACT_ID` | Optional separate contract for maintenance-pool escrows; falls back to `ESCROW_CONTRACT_ID`. |
| `USDC_TOKEN_CONTRACT_ID`, `XLM_TOKEN_CONTRACT_ID` | Soroban token (SAC) contract addresses, passed as `escrow::fund`'s required `token` argument. |
| `ESCROW_DEADLINE_SECONDS` | Fallback `escrow::fund` deadline (seconds from fund time) when the bounty/milestone has none. Default `7776000` (90 days), minimum `86400`. **Controls when anyone can refund the escrow on-chain** — see [below](#escrow_deadline_seconds-and-the-permissionless-refund-window). |
| `TREASURY_SECRET` | Platform signer used to submit release/refund transactions; required for live Soroban calls. |
| `SOROBAN_INCLUSION_FEE` | Transaction inclusion bid in stroops (default `5000`, 50× `BASE_FEE`); resource fees are added by Soroban transaction assembly. The bid doubles for up to two resubmissions after a never-included transaction expires. |
| `SOROBAN_FEE_BPS` | Fallback protocol fee in basis points for explicit dry-run mode (default `250`). Live releases read `get_fee_bps` from the escrow contract. |

`docker-compose.yml` exposes the app directly and does not add a reverse proxy,
so keep `TRUST_PROXY=false` for that setup. For an ingress deployment, set it
to the number of fixed, trusted proxy hops (commonly `1` for one ingress), or
prefer a list of the ingress proxy's trusted IPs/subnets when those are known.
Avoid `true`: it trusts forwarding headers regardless of their source.

## Escrow / Soroban integration

`src/escrow/soroban-client.service.ts` wraps `@stellar/stellar-sdk`'s
`rpc.Server` to build, simulate, sign, and submit Soroban contract
invocations (`fund` / `release` / `refund`) against the
escrow contract. `src/escrow/escrow.service.ts` is the orchestration layer:
it calls the client, then persists `Escrow`/`Payment` rows and drives the
`Bounty`/`Milestone`/`MaintenancePool` state alongside it.

### Dry-run mode

> Dry-run mode is disabled by default. Synthetic escrow/payment rows carry the
> `dry_run` status and do not count as confirmed payouts. Bounty workflow
> statuses may still advance; inspect the linked escrow/payment status before
> interpreting a dry-run bounty as settled.

**When it engages.** Dry-run mode is enabled only by setting
`SOROBAN_DRY_RUN=true`. Missing contract or signer configuration does not
silently trigger a dry run: invocations fail with an explicit configuration
error. Production boot validation also requires the contract, signer, and
supported token addresses unless dry-run mode was deliberately enabled.

**What it does.** Instead of building, signing and submitting a transaction,
`invoke` logs a warning and returns a synthetic result. Escrow and payment
rows are marked `dry_run`, not as locked, released, refunded, or confirmed
on-chain. Dry-run payments are excluded from confirmed payout and earnings
totals:

| Operation | Records written |
|---|---|
| Fund (`fund`) | `Escrow` → `dry_run`, with a synthetic `fundTxHash`. |
| Release / split release / partial release | `Escrow` and recipient `Payment` rows remain explicitly `dry_run`; protocol fees are recorded separately. |
| Pool withdraw | `Payment` with `status = dry_run`. |
| Refund | `Escrow` → `dry_run` with a synthetic `refundTxHash`. |

No tokens move and contract checks (balance, status, authorisation) do not run.
The database row lock still prevents concurrent duplicate operations (see
`src/escrow/escrow-lock.integration.spec.ts`).

**How to recognise dry-run records.** Both escrow/payment status and the
synthetic `dry-run-<method>-<epoch-ms>` transaction hash identify dry-run
records. The invocation result uses status `DRY_RUN` with `ledger = null`.
To find them in a database:

```sql
SELECT id, status, "txHash" FROM payments WHERE status = 'dry_run';
SELECT id, status, "fundTxHash", "releaseTxHash", "refundTxHash"
  FROM escrows WHERE status = 'dry_run';
```

Dry-run data should never be mixed with real data: if a database was ever
run in dry-run mode, don't later point a configured instance at it.

**Leaving dry-run mode.** Once real contracts are deployed:

1. Set `SOROBAN_DRY_RUN=false`, `ESCROW_CONTRACT_ID` (and
   `MAINTENANCE_POOL_CONTRACT_ID` if the pool uses a separate deployment),
   plus `USDC_TOKEN_CONTRACT_ID` / `XLM_TOKEN_CONTRACT_ID` for the token
   argument.
2. Set `TREASURY_SECRET` to a funded Stellar account.
3. Confirm the contract's `fund`/`release`/`refund` function signatures match
   the ones documented at the top of `soroban-client.service.ts` (adjusted in
   this change to track `mergefi-contracts`' `contracts/escrow/src/lib.rs`).

No private keys for end users are ever stored — only the platform treasury
signer, and only as an env var for this MVP (see Roadmap: move to KMS/multi-sig).

### `ESCROW_DEADLINE_SECONDS` and the permissionless refund window

Every escrow is funded with a `deadline` argument to `escrow::fund`. It is
the funding bounty's or milestone's own deadline, or, when it has none,
`now + ESCROW_DEADLINE_SECONDS` (`EscrowService.resolveDeadline`; default
`7776000` = 90 days, from `src/config/configuration.ts`).

That deadline is enforced **on-chain**, not just recorded locally. In the
deployed `mergefi-contracts` escrow contract, once
`now >= deadline + GRACE_PERIOD`, where `GRACE_PERIOD` is **14 days**,
`escrow::refund` becomes **permissionless**. Anyone can call it, and the
funds go back to the funders on record. This backend is not consulted. A
bounty it still considers open and claimable can be unwound by a third party
from that point on.

So `ESCROW_DEADLINE_SECONDS` decides how long each deadline-less bounty
stays safe from third-party refunds:

| `ESCROW_DEADLINE_SECONDS` | Permissionless refund opens after |
|---|---|
| `7776000` (90 days, default) | 104 days |
| `2592000` (30 days) | 44 days |
| `604800` (7 days) | 21 days |

Choose a value longer than a bounty can realistically stay open. A value
that seems sensible for a bounty deadline, like 7 days, is usually too
short here. Changing it only affects escrows funded afterwards; existing
escrows keep the deadline they were funded with.

The value is checked at boot in every environment (`collectConfigIssues`
in `src/config/validate-required-config.ts`). It must be an integer of at
least `86400` (1 day), or the app refuses to start. Without this check, a
typo would turn into `NaN` and a `RangeError` at fund time. The 1-day
minimum only catches unit mistakes (`90` meant as days); it is not a
recommended value. `PORT` is validated the same way (an integer from 1 to
65535).

## API overview

All routes are mounted under `/api` (see `app.setGlobalPrefix` in `main.ts`).
Full interactive documentation, generated from the same decorators as the
code, is served at:

```
/api/docs
```

Route groups: `/api/auth`, `/api/users`, `/api/github`,
`/api/github/webhooks` (unauthenticated, HMAC-verified), `/api/bounties`,
`/api/escrow`, `/api/teams`, `/api/milestones`, `/api/maintenance-pools`,
`/api/sponsors`, `/api/reputation`, `/api/analytics`.

### Idempotency

Every fund/claim/release/refund mutation — `POST /bounties/:id/fund`,
`/claim`, `/refund`; `/escrow/fund`, `/escrow/:id/release`,
`/escrow/:id/split-release`, `/escrow/:id/refund`; `/milestones/:id/fund`,
`/milestones/:id/issues/:issueId/resolve`; `/maintenance-pools/:id/deposit`,
`/maintenance-pools/:id/assign-reward` — requires a client-supplied
`Idempotency-Key` header (a UUID) so a retried request after a dropped
connection can't double-execute:

- A repeated request with the same key (scoped per endpoint and, once a
  route requires auth, per caller) returns the original response without
  re-running the mutation. 2xx and 4xx outcomes are cached and replayed
  verbatim; a 5xx is not cached, so a retry after a genuine server error
  runs cleanly rather than replaying the failure forever.
- A second request reusing a key that's still mid-flight gets `409
  Conflict` instead of racing into a duplicate execution. If the original
  request crashed before completing, the key is reclaimed after 30s so it
  doesn't 409 forever.
- A key's identity is bound to the actual request, not just the route: a
  SHA-256 fingerprint of the path params and body is stored alongside the
  key, and a retry whose fingerprint doesn't match gets `422 Unprocessable
  Entity` instead of replaying the original request's response. Without
  this, reusing a key across two different resources on the same route
  (e.g. `Idempotency-Key: K` sent to both `/escrow/A/release` and
  `/escrow/B/release`) would silently replay A's cached response for B,
  which looks like a successful release to the client while B's funds
  never actually moved (#54).
- Cached keys are retained for 24h (`IDEMPOTENCY_KEY_TTL_MS` in
  `IdempotencyInterceptor`) and swept hourly by `IdempotencyCleanupService`.

See `src/common/idempotency/` for the interceptor, decorator, and cleanup
job.

## Setup, run, test

You can run this project either natively on your host machine or completely containerized using Docker.

### Node.js version

This repository runs on **Node.js 24**. The major is pinned in one place,
`.nvmrc`, and everything else is kept in step with it:

| Where | Value |
| --- | --- |
| `.nvmrc` | `24` |
| `package.json` `engines.node` | `>=24.0.0 <25.0.0` |
| `.npmrc` | `engine-strict=true` — `npm install`/`npm ci` refuse to run on any other major instead of only warning |
| CI (`.github/workflows/ci.yml`) | `node-version-file: .nvmrc` |
| `Dockerfile` | `node:24-alpine` |

With [nvm](https://github.com/nvm-sh/nvm) (or fnm / Volta, which read the
same file), run `nvm use` in this directory before `npm install`.

The sibling repositories pin different majors today (`mergefi-frontend` builds
on 20; `mergefi-contracts`' scripts require >=22.12 while its `.nvmrc` says
20). Running the backend next to the frontend locally therefore needs a
version manager and a `nvm use` in each checkout. Aligning the org on a single
major is tracked in #835. When that lands, change `.nvmrc` here and update the
rows above to match.

### 1. Local Development via Docker Compose (Recommended)

This is the easiest way to get up and running with a pre-configured, isolated PostgreSQL database.

```bash
# A. Configure Environment Variables
cp .env.example .env

# B. Start App and Database services
docker compose up --build
```

- **Hot Reloading**: The codebase is mounted into the container using a bind mount. File changes on the host will automatically trigger application restarts.
- **Node Modules Isolation**: The container uses an anonymous volume for `/usr/src/app/node_modules`. This prevents Windows/Host compiled node packages from contaminating the Linux-native container.
- **Services**:
  - The API is served at `http://localhost:4000/api` (Swagger docs at `http://localhost:4000/api/docs`).
  - PostgreSQL is mapped to port `5432` on your localhost with credentials `postgres:postgres` and database name `mergefi`.

### 2. Local Development Natively on Host

If you prefer to run NestJS directly on your host machine:

```bash
# A. Install Dependencies (on the Node major in .nvmrc — see "Node.js version")
nvm use
npm install

# B. Spin up only the Database service in Docker
docker compose up -d db

# C. Configure Environment Variables
cp .env.example .env
# Set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mergefi

# D. Start NestJS in development mode
npm run start:dev
```

### 3. Production Builds & Security

The Dockerfile is structured as a secure, multi-stage build running on Alpine Linux.

#### Build the production image:
```bash
docker build --target runner -t mergefi-backend:latest .
```

#### Production Guardrails (Important):
- **Least Privilege**: The container runs under the non-root `node` user (`USER node`).
- **Production Mode**: The final image forces `NODE_ENV=production`.
- **Graceful Shutdown**: Nest shutdown hooks handle `SIGTERM` and `SIGINT`, allowing providers to clean up and the HTTP server to drain active requests. Set the orchestrator's termination grace period longer than the Soroban poll ceiling (about 62 seconds, plus request/setup overhead) so in-flight escrow operations have time to finish.
- **Required-config Enforcer**: When `NODE_ENV=production`, `assertRequiredConfig` (`src/config/validate-required-config.ts`, called from `src/main.ts`) refuses startup unless required values are configured, including a non-default `DATABASE_URL`, `DATABASE_SSL=true`, and `DATABASE_SYNCHRONIZE=false`. Production URLs may not specify `sslmode=disable`; PostgreSQL TLS verifies certificates by default. It also checks `JWT_SECRET`, GitHub credentials and webhook secret, and the live Soroban deployment/signing settings. You **must** provide these when running the production container, e.g.:
  ```bash
  docker run -p 3000:3000 \
    -e JWT_SECRET="your-highly-secure-random-jwt-key" \
    -e DATABASE_URL="postgresql://user:pass@db-host:5432/mergefi" \
    -e DATABASE_SSL=true \
    -e GITHUB_CLIENT_ID=... -e GITHUB_CLIENT_SECRET=... \
    -e GITHUB_WEBHOOK_SECRET=... \
    -e ESCROW_CONTRACT_ID=... -e TREASURY_SECRET=... \
    mergefi-backend:latest
  ```

### 4. Running Tests

Unit tests and end-to-end tests are fully supported:

```bash
# Run unit tests natively
npm test

# Run unit tests with code coverage
npm run test:cov

# Run End-to-End (E2E) tests (requires PostgreSQL to be running on DATABASE_URL)
npm run test:e2e
```

Unit tests cover critical domains including:
- `src/bounties/bounty-state-machine.spec.ts` — the bounty lifecycle state machine.
- `src/teams/team-split.util.spec.ts` — team payout split percentage math.
- `src/escrow/escrow.service.spec.ts` — escrow fund/release/refund orchestration (Soroban client mocked).
- `src/github/webhook-signature.util.spec.ts` — GitHub webhook HMAC-SHA256 signature verification.
- `src/github/github-webhooks.service.spec.ts` — webhook-to-escrow release logic.
- `src/bounties/bounties.service.spec.ts` — bounty core management.
- `src/sponsors/sponsors.service.spec.ts` — sponsor dashboard aggregate queries (budgetLocked/totalSpend read the Escrow/Payment ledger directly).
- `src/database/escrow-fk-integrity.integration.spec.ts` — **integration** test against a real Postgres (requires `DATABASE_URL`, not mocked): the exactly-one-parent CHECK constraint on `escrows`, and that sponsor dashboard figures survive a parent bounty/milestone being deleted.
- `src/escrow/escrow-lock.integration.spec.ts` — **integration** test against a real Postgres: two concurrent `release` calls (and two over-budget `releasePartial` calls) on one escrow serialise on `withLockedEscrow`'s row lock, so exactly one succeeds and exactly one `Payment` is written (#844).
- `src/common/filters/global-exception.filter.integration.spec.ts` — includes the throttled **429** contract mergefi-frontend depends on: a `Retry-After` header and a JSON body with `message` (#842).
- `test/merge-to-payout.e2e-spec.ts` — **e2e** against a real Postgres: a signed `pull_request.closed(merged)` delivery drives the whole chain (signature gate → webhook dispatch → `markMergedAndRelease` → escrow release/split → `Payment` rows → bounty PAID → platform-summary refresh), for a single contributor and for a team of three (#848).
- `test/soroban-xdr-encoding.e2e-spec.ts` — decodes the `xdr.ScVal`s the real Stellar SDK produces for every contract call the backend makes (`fund`, `release`, `refund`, `withdraw`, `release_partial`) and checks them against the `mergefi-contracts` signatures (#840). It runs under the e2e config because the unit config stubs the SDK.
- `src/analytics/analytics.integration.spec.ts` — Postgres load/parity test: SQL heatmap + top-N match the old JS bucketing on a small fixture; a 3,000-bounty seed must not call `find`/`getMany` (O(n) entity load → O(days)+O(1) aggregates), `forContributor` under 2s, cached homepage summary on a second call.

`DATABASE_SYNCHRONIZE=true` is honored only in development for fast local iteration. It is ignored in other environments, and production startup refuses to proceed if it is set. Real deployments should run migrations instead — see `src/database/migrations/` and the `migration:*` npm scripts below.

### Migrations

Schema changes are tracked as TypeORM migrations under `src/database/migrations/`, driven by the `DataSource` in `src/database/data-source.ts`:

```bash
# Generate a migration from entity changes (requires DATABASE_URL pointed at a real DB to diff against)
npm run migration:generate -- src/database/migrations/SomeChange

# Run all pending migrations
npm run migration:run

# Revert the most recently applied migration
npm run migration:revert
```

`1784000000000-InitialSchema` is the baseline: on an empty database it creates
the schema as it stood before the first incremental migration, so
`migration:run` works from scratch; on a database originally built by
`synchronize` it detects the existing tables and does nothing. Every migration
must have a unique timestamp prefix and a working `down()`.

CI enforces both (#830): it runs `migration:run` against an empty Postgres,
reverts every migration, checks that left no tables behind, runs them again and
diffs the schema against the first pass. The e2e suite then runs on that
migrated schema rather than one built by `synchronize`, so a migration that
fails, can't be reverted, or diverges from what the code expects breaks the
build instead of a deploy.

### Dependency overrides

`package.json` carries an `overrides` block for transitive dependencies whose
fixed version a direct dependency doesn't yet allow. CI runs
`npm audit --audit-level=high`, and Dependabot (`.github/dependabot.yml`) opens
weekly npm and GitHub Actions update PRs. Remove an override once the
dependency that pulls it in requires a patched version on its own; `npm ls
<package>` shows where it comes from.

- `multer` (via `@nestjs/platform-express`): pinned to `^2.5.0` for the
  multipart Denial-of-Service and file-size-bypass advisories in `<=2.4.0`
  (GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf, GHSA-qvfw-j98x-7q72 and related),
  and originally to `^2.2.0` for GHSA-72gw-mp4g-v24j / GHSA-3p4h-7m6x-2hcm.
  Removable once `@nestjs/platform-express` depends on `multer >=2.5.0`.
- `brace-expansion@1` (via `minimatch@3`, from ESLint's and Jest's tooling —
  dev only): pinned to `^1.1.22` for the expansion Denial-of-Service advisories
  in `<=1.1.20` (GHSA-3jxr-9vmj-r5cp and related). Removable once those tools
  stop depending on `minimatch@3`.

## Roadmap

- [x] ~~Wire up TypeORM migrations (currently relies on `synchronize` for local dev only).~~ See `src/database/migrations/` and the Migrations section above.
- [ ] Move GitHub sync from a static PAT to a GitHub App installation-token flow for multi-org, least-privilege access.
- [ ] Deploy the real escrow contract from `mergefi-contracts` and drop the Soroban dry-run fallback.
- [ ] Replace the single `TREASURY_SECRET` signer with a proper signing service (KMS / multi-sig) before handling real funds.
- [x] ~~Add a scheduled job for `BountiesService.expireOverdue()` (deadline sweeps).~~ See `BountyExpiryScheduler` (hourly `@Cron`).
- [ ] Add a scheduled job for recurring `MaintenancePool` deposits.
- [ ] Add role-based authorization guards (currently JWT-authenticated but not role-scoped) to maintainer/sponsor-only endpoints.
- [ ] Add pagination/filtering to list endpoints (bounties, milestones, pools) as data volume grows.
- [ ] Weighted (not just even) per-issue milestone budget distribution.

## License

Licensed under the [Apache License, Version 2.0](LICENSE), the same terms as
`mergefi-contracts`. Contributions submitted to this repository are accepted
under that license.
