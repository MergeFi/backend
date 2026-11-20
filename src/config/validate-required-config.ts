import { AppConfig } from './configuration';

/**
 * JWT secret fallback baked into {@link AppConfig} for local development.
 * Booting production with this value still in place is refused.
 */
export const INSECURE_DEFAULT_JWT_SECRET = 'insecure-dev-secret';

/**
 * DATABASE_URL fallback baked into configuration.ts for local development —
 * a local Postgres with the well-known `postgres:postgres` credentials.
 * Booting production still pointed at this is refused: it would silently try
 * to connect to whatever is listening on localhost:5432.
 */
export const DEFAULT_LOCAL_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/mergefi';

export interface ConfigIssue {
  /** The environment variable the operator needs to set. */
  key: string;
  /** Human-readable explanation of what breaks while it is unset. */
  message: string;
}

/**
 * Shortest `ESCROW_DEADLINE_SECONDS` accepted at boot: one day. The value is
 * passed straight to `escrow::fund`'s `deadline`, and once
 * `now >= deadline + GRACE_PERIOD` (14 days in mergefi-contracts) the
 * contract's `refund` becomes permissionless — anyone can unwind the escrow.
 * This floor only catches unit mistakes (e.g. `90` meaning "90 days"); it is
 * not a recommendation — see README "ESCROW_DEADLINE_SECONDS" (#851).
 */
export const MIN_ESCROW_DEADLINE_SECONDS = 24 * 60 * 60;

type RequiredConfig = Pick<
  AppConfig,
  'env' | 'port' | 'jwt' | 'github' | 'stellar' | 'database'
>;

/**
 * Numeric settings that are broken in *every* environment when malformed:
 * `parseInt` turns a typo into NaN, which surfaces much later as a failed
 * `listen()` or a RangeError at escrow fund time (#610, #851).
 */
function collectNumericConfigIssues(config: RequiredConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  if (
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535
  ) {
    issues.push({
      key: 'PORT',
      message: `PORT must be an integer between 1 and 65535 (got ${config.port})`,
    });
  }

  const deadline = config.stellar.escrowDeadlineSeconds;
  if (!Number.isInteger(deadline) || deadline < MIN_ESCROW_DEADLINE_SECONDS) {
    issues.push({
      key: 'ESCROW_DEADLINE_SECONDS',
      message:
        `ESCROW_DEADLINE_SECONDS must be an integer of at least ${MIN_ESCROW_DEADLINE_SECONDS} (1 day) (got ${deadline}) — ` +
        "it sets escrow::fund's deadline, after which (plus the contract's 14-day grace period) anyone can trigger a refund",
    });
  }

  return issues;
}

/**
 * Collects every required-in-production configuration problem — not just the
 * single JWT_SECRET check that used to live inline in `main.ts` (#153).
 *
 * Each of these secrets fails *silently* today: an empty
 * `GITHUB_WEBHOOK_SECRET` makes `verifyGithubSignature` reject 100% of
 * incoming webhook deliveries; empty `TREASURY_SECRET`/`ESCROW_CONTRACT_ID`
 * pin `SorobanClientService` to permanent dry-run mode (escrow calls never
 * touch the chain); a default `DATABASE_URL` connects to a local Postgres
 * with default credentials. None of that surfaces at boot without this pass.
 *
 * Numeric settings (PORT, ESCROW_DEADLINE_SECONDS) are validated in every
 * environment; the secret checks only apply in production.
 *
 * Returns an empty array when the configuration is safe to start with.
 */
export function collectConfigIssues(config: RequiredConfig): ConfigIssue[] {
  const issues = collectNumericConfigIssues(config);
  if (config.env !== 'production') return issues;

  const requireNonEmpty = (
    key: string,
    value: string | null | undefined,
    consequence: string,
  ): void => {
    if (!value || value.trim() === '') {
      issues.push({
        key,
        message: `${key} is unset — ${consequence}`,
      });
    }
  };

  if (config.jwt.secret === INSECURE_DEFAULT_JWT_SECRET) {
    issues.push({
      key: 'JWT_SECRET',
      message:
        'JWT_SECRET is still the insecure dev default — set a long random value',
    });
  } else {
    requireNonEmpty(
      'JWT_SECRET',
      config.jwt.secret,
      'session tokens cannot be signed',
    );
  }

  if (
    !config.database.url ||
    config.database.url === DEFAULT_LOCAL_DATABASE_URL
  ) {
    issues.push({
      key: 'DATABASE_URL',
      message:
        'DATABASE_URL is unset or still the local-dev default — production would connect to localhost:5432 with default postgres:postgres credentials',
    });
  }

  requireNonEmpty(
    'GITHUB_WEBHOOK_SECRET',
    config.github.webhookSecret,
    'every incoming GitHub webhook delivery is rejected by signature verification',
  );
  requireNonEmpty(
    'GITHUB_CLIENT_ID',
    config.github.clientId,
    'GitHub OAuth login cannot be completed',
  );
  requireNonEmpty(
    'GITHUB_CLIENT_SECRET',
    config.github.clientSecret,
    'GitHub OAuth login cannot be completed',
  );
  requireNonEmpty(
    'ESCROW_CONTRACT_ID',
    config.stellar.escrowContractId,
    'escrow calls run in dry-run mode and never settle on-chain',
  );
  requireNonEmpty(
    'MAINTENANCE_POOL_CONTRACT_ID',
    config.stellar.maintenancePoolContractId,
    'maintenance-pool deposits are refused at runtime — without a configured contract the service cannot safely route pool funds (#754)',
  );
  requireNonEmpty(
    'TREASURY_SECRET',
    config.stellar.treasurySecret,
    'escrow release/refund transactions cannot be signed',
  );

  return issues;
}

/**
 * Fails fast and loudly when any required-in-production secret is missing
 * or a numeric setting is malformed, listing every problem at once rather
 * than one boot attempt per fix.
 */
export function assertRequiredConfig(config: RequiredConfig): void {
  const issues = collectConfigIssues(config);
  if (issues.length === 0) return;

  const detail = issues.map((issue) => `  - ${issue.message}`).join('\n');
  const where = config.env === 'production' ? ' in production' : '';
  throw new Error(
    `Refusing to start${where} with an incomplete configuration:\n${detail}\n` +
      'Set the environment variables listed above (see .env.example) and restart.',
  );
}
