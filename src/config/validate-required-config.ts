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

type RequiredConfig = Pick<
  AppConfig,
  'env' | 'jwt' | 'github' | 'stellar' | 'database'
>;

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
 * Returns an empty array outside production, or when the configuration is
 * safe to start with.
 */
export function collectConfigIssues(config: RequiredConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
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
    requireNonEmpty('JWT_SECRET', config.jwt.secret, 'session tokens cannot be signed');
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
    'TREASURY_SECRET',
    config.stellar.treasurySecret,
    'escrow release/refund transactions cannot be signed',
  );

  return issues;
}

/**
 * Fails fast and loudly when any required-in-production secret is missing,
 * listing every problem at once rather than one boot attempt per fix.
 */
export function assertRequiredConfig(config: RequiredConfig): void {
  const issues = collectConfigIssues(config);
  if (issues.length === 0) return;

  const detail = issues.map((issue) => `  - ${issue.message}`).join('\n');
  throw new Error(
    `Refusing to start in production with an incomplete configuration:\n${detail}\n` +
      'Set the environment variables listed above (see .env.example) and restart.',
  );
}
