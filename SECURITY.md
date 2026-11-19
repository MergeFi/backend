# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue, pull request or discussion for a
security vulnerability.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/MergeFi/backend/security/advisories/new)
for this repository (**Security → Report a vulnerability**). If that is
unavailable to you, email **security@mergefi.app**.

Please include:

- the affected endpoint, module or file (and commit, if known);
- steps to reproduce, or a proof of concept against a local instance;
- the impact — what an attacker can read, change, or move;
- any suggested fix.

Do not test against production deployments or real user accounts, and do not
move or lock real funds. A local instance (see the README) runs Soroban in
dry-run mode by default and is enough for almost every report.

## What to expect

- Acknowledgement within **48 hours**.
- An initial assessment and expected fix timeline within **7 business days**.
- Credit in the advisory once a fix is released, unless you prefer otherwise.

Please give us a reasonable window to ship a fix before disclosing publicly.

## Scope

In scope — this repository (`MergeFi/backend`), including:

- authentication: GitHub OAuth, JWT issuance and validation, role and
  repository-scope guards;
- storage and encryption of OAuth tokens and other secrets;
- escrow orchestration and payouts: fund, release, split release, refund,
  maintenance-pool withdrawals, and the Soroban client that signs them with
  the treasury key;
- GitHub webhook signature verification and the merge-to-payout path;
- idempotency, rate limiting, and authorisation on any API route;
- CI configuration and dependencies in this repository.

Out of scope here — report to the owning repository instead:

- the web app UI and wallet signing:
  [MergeFi/frontend](https://github.com/MergeFi/frontend/security);
- the Soroban contracts themselves:
  [MergeFi/contracts](https://github.com/MergeFi/contracts/security).

Findings that only affect dry-run mode on a local instance are still welcome
when they would also apply to a configured deployment.

## Supported versions

Only the `main` branch is supported. Fixes are not backported.
