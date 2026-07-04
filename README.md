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
- [API overview](#api-overview)
- [Setup, run, test](#setup-run-test)
- [Roadmap](#roadmap)

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
- **Config-driven, not hardcoded.** There is no deployed escrow contract for
  this MVP session, so `ESCROW_CONTRACT_ID` / `TREASURY_SECRET` are read from
  env and the Soroban client transparently falls back to a "dry run" mode
  when they're absent — see [Escrow / Soroban integration](#escrow--soroban-integration).

## Modules

| Module | Responsibility |
|---|---|
| `auth` | GitHub OAuth login (`passport-github2`) and JWT session issuance/validation (`passport-jwt`). |
| `users` | User + linked `GithubAccount` records, role management, Stellar address linking. |
| `github` | Repository/issue sync via Octokit (`github-sync.service.ts`) and inbound webhook handling with HMAC-SHA256 signature verification (`github-webhooks.service.ts`, `webhook-signature.util.ts`). On a merged PR, resolves the linked issue → bounty and triggers escrow release. |
| `bounties` | Paid-issue lifecycle: create, fund, claim, review, merge, pay, refund, expire. State machine in `bounty-state-machine.ts`. |
| `escrow` | Orchestrates fund/release/split-release/refund against the escrow contract via `SorobanClientService`, and keeps `Escrow`/`Payment` rows in sync. |
| `teams` | Team bounties: create a team with percentage splits (e.g. frontend 40 / backend 40 / testing 20), assign it to a bounty, validated to sum to 100%. |
| `milestones` | Fund an entire milestone's budget up front; distribute it incrementally as issues resolve (`resolveIssue`), splitting the remaining budget across still-open issues. |
| `maintenance-pool` | Recurring sponsor deposits into a shared pool; maintainers assign rewards out of the running balance for maintenance-type work. |
| `sponsors` | Sponsor dashboard: active bounties, total spend, budget locked in escrow, milestone progress, recent payments. |
| `reputation` | Computes and snapshots per-contributor stats: earnings, merged PR count, completion rate, avg review time, on-time delivery %, languages, orgs. |
| `analytics` | Lifetime earnings, repo/org counts, merge rate, review time, languages, a payout heatmap, and top clients (sponsors) per contributor; a platform-wide summary for the homepage. |

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
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Session token signing. |
| `GITHUB_CLIENT_ID` / `_SECRET`, `GITHUB_OAUTH_CALLBACK_URL` | GitHub OAuth login app. |
| `GITHUB_API_TOKEN` | Token used by Octokit for repo/issue sync (PAT for now; see roadmap). |
| `GITHUB_WEBHOOK_SECRET` | HMAC-SHA256 secret configured on the GitHub webhook. |
| `STELLAR_NETWORK`, `HORIZON_URL`, `SOROBAN_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE` | Stellar network config. |
| `ESCROW_CONTRACT_ID` | Deployed escrow contract ID from `mergefi-contracts`. **Not set in this environment** — see below. |
| `MAINTENANCE_POOL_CONTRACT_ID` | Optional separate contract for the maintenance pool; falls back to `ESCROW_CONTRACT_ID`. |
| `TREASURY_ADDRESS` / `TREASURY_SECRET` | Platform signer used to submit release/refund transactions. |
| `USDC_ASSET_CODE` / `USDC_ASSET_ISSUER` | Stablecoin asset identity on Stellar. |

## Escrow / Soroban integration

`src/escrow/soroban-client.service.ts` wraps `@stellar/stellar-sdk`'s
`rpc.Server` to build, simulate, sign, and submit Soroban contract
invocations (`fund` / `release` / `split_release` / `refund`) against the
escrow contract. `src/escrow/escrow.service.ts` is the orchestration layer:
it calls the client, then persists `Escrow`/`Payment` rows and drives the
`Bounty`/`Milestone`/`MaintenancePool` state alongside it.

**Current limitation:** there is no live deployed escrow contract available
in this environment (`mergefi-contracts` is a separate repo/session). When
`ESCROW_CONTRACT_ID` or `TREASURY_SECRET` are unset, `SorobanClientService`
transparently short-circuits into a deterministic **dry-run** mode — it logs
a warning, returns a synthetic tx hash, and skips the network call — so the
rest of the system (state transitions, DB writes, split-percentage math,
webhook-triggered releases) can still be exercised end-to-end in tests and
local dev. Once real contracts are deployed:

1. Set `ESCROW_CONTRACT_ID` (and `MAINTENANCE_POOL_CONTRACT_ID` if separate).
2. Set `TREASURY_ADDRESS` / `TREASURY_SECRET` to a funded Stellar account.
3. Confirm the contract's `fund`/`release`/`split_release`/`refund` function
   signatures match the ones documented at the top of
   `soroban-client.service.ts` (adjust argument encoding there if not —
   TODOs are marked inline).

No private keys for end users are ever stored — only the platform treasury
signer, and only as an env var for this MVP (see Roadmap: move to KMS/multi-sig).

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

## Setup, run, test

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env
# fill in DATABASE_URL at minimum to run against a real Postgres instance

# 3. run
npm run start:dev      # watch mode
npm run start:prod     # after `npm run build`

# 4. build
npm run build

# 5. test
npm test                # unit tests (Jest, src/**/*.spec.ts)
npm run test:cov        # with coverage
npm run test:e2e        # e2e (requires a running Postgres per DATABASE_URL)
```

Unit tests cover, among other things:

- `src/bounties/bounty-state-machine.spec.ts` — the bounty lifecycle state machine.
- `src/teams/team-split.util.spec.ts` — team payout split percentage math.
- `src/escrow/escrow.service.spec.ts` — escrow fund/release/split-release/refund orchestration, with the Soroban client mocked.
- `src/github/webhook-signature.util.spec.ts` — GitHub webhook HMAC-SHA256 signature verification.
- `src/github/github-webhooks.service.spec.ts` — end-to-end webhook → bounty release wiring.
- `src/bounties/bounties.service.spec.ts` — bounty service against mocked repositories/escrow.

`DATABASE_SYNCHRONIZE=true` will auto-create tables from entities for quick
local iteration; a real migration workflow (`typeorm migration:generate`) is
recommended before this touches any shared/staging database — see Roadmap.

## Roadmap

- [ ] Wire up TypeORM migrations (currently relies on `synchronize` for local dev only).
- [ ] Move GitHub sync from a static PAT to a GitHub App installation-token flow for multi-org, least-privilege access.
- [ ] Deploy the real escrow contract from `mergefi-contracts` and drop the Soroban dry-run fallback.
- [ ] Replace the single `TREASURY_SECRET` signer with a proper signing service (KMS / multi-sig) before handling real funds.
- [ ] Add a scheduled job for `BountiesService.expireOverdue()` (deadline sweeps) and recurring `MaintenancePool` deposits.
- [ ] Add role-based authorization guards (currently JWT-authenticated but not role-scoped) to maintainer/sponsor-only endpoints.
- [ ] Add pagination/filtering to list endpoints (bounties, milestones, pools) as data volume grows.
- [ ] Weighted (not just even) per-issue milestone budget distribution.
