import { BASE_FEE } from '@stellar/stellar-sdk';
import { AssetType } from '../common/enums';

const DEFAULT_SOROBAN_INCLUSION_FEE = Number(BASE_FEE) * 50;

export interface AppConfig {
  env: string;
  port: number;
  trustProxy: false | number | string[];
  appUrl: string;
  frontendUrl: string;
  /** Exact origins (and/or `*.suffix` patterns) the CORS middleware allows. */
  corsAllowedOrigins: string[];
  logLevel: string;
  database: {
    url: string;
    synchronize: boolean;
    logging: boolean;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  github: {
    clientId: string;
    clientSecret: string;
    oauthCallbackUrl: string;
    apiToken: string;
    webhookSecret: string;
    /**
     * Comma-separated `owner/repo` entries that a MAINTAINER may introduce as
     * a first-time sync (#312). A repository already tracked in the database is
     * governed by its `maintainerId` instead, so this only gates new repos.
     */
    syncAllowedRepos: string;
  };
  analytics: {
    /**
     * In-process TTL for GET /analytics/platform. Also invalidated on
     * bounty create/pay and first-time repository insert.
     */
    platformSummaryTtlMs: number;
  };
  stellar: {
    network: string;
    sorobanRpcUrl: string;
    networkPassphrase: string;
    escrowContractId: string;
    /**
     * Optional separate deployment for maintenance-pool escrows. Falls back
     * to `escrowContractId` when unset. Threaded through to
     * `SorobanClientService.invoke(..., { contractId })` by `EscrowService`
     * so maintenance-pool fund/release/refund calls target this contract
     * instead of the single bounty escrow contract (#157).
     */
    maintenancePoolContractId: string;
    treasurySecret: string;
    /** Synthetic results are returned only when explicitly enabled. */
    dryRun: boolean;
    /** Transaction inclusion bid in stroops, before Soroban resource fees. */
    inclusionFee: number;
    /** Dry-run fallback; live payouts read the fee from the contract. */
    protocolFeeBps: number;
    /**
     * Soroban token (SAC) contract addresses per supported asset. The real
     * `escrow::fund(issue_id, sponsor, token, amount, deadline)` takes the
     * token contract as a required argument (#158); this is where that
     * address is resolved from `Escrow.asset`. Live funding fails explicitly
     * when the selected asset has no configured contract.
     */
    assetContractIds: Record<AssetType, string>;
    /**
     * Fallback escrow deadline, in seconds from fund time, used as the real
     * `escrow::fund`'s `deadline` argument when the funding bounty/milestone
     * carries no explicit deadline of its own (#158). The contract's
     * refund-after-deadline mechanism depends on this being set.
     */
    escrowDeadlineSeconds: number;
  };
  schedulers: {
    /**
     * Whether this process runs the `@Cron` sweeps
     * (`BountyExpiryScheduler`, `IdempotencyCleanupService`,
     * `EscrowReconciliationScheduler`). Set
     * `RUN_SCHEDULERS=false` on web replicas when a separate worker tier owns
     * the schedulers (#831). See `parseSchedulersEnabled` for accepted values.
     */
    enabled: boolean;
  };
}

/**
 * `RUN_SCHEDULERS` is enabled unless explicitly switched off. `false`, `0`,
 * `no` and `off` (case-insensitive, surrounding whitespace ignored) disable
 * it, so a near-miss spelling such as `FALSE` no longer silently leaves the
 * schedulers running on every replica (#831).
 */
export function parseSchedulersEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  return !['false', '0', 'no', 'off'].includes(raw.trim().toLowerCase());
}

export function parseTrustProxy(
  raw: string | undefined,
): false | number | string[] {
  const value = raw?.trim();
  if (!value || value.toLowerCase() === 'false') return false;
  if (value.toLowerCase() === 'true') {
    throw new Error(
      'TRUST_PROXY=true is not supported; configure trusted proxy hops or addresses',
    );
  }
  if (/^\d+$/.test(value)) {
    const hopCount = Number(value);
    if (Number.isSafeInteger(hopCount)) return hopCount;
    throw new Error('TRUST_PROXY hop count must be a safe integer');
  }
  const addresses = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (addresses.length === 0) {
    throw new Error(
      'TRUST_PROXY must be false, a hop count, or proxy addresses',
    );
  }
  return addresses;
}
const defaultAppUrl = () =>
  process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? '4000'}`;

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',
  // CORS_ALLOWED_ORIGINS is a comma-separated list of exact origins (e.g.
  // "https://app.mergefi.dev,https://staging.mergefi.dev") or *.suffix
  // patterns (e.g. "*.vercel.app") for preview deployments. Falls back to
  // [frontendUrl] so existing single-origin setups need no env change.
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [process.env.FRONTEND_URL ?? 'http://localhost:3001'],
  port: parseInt(process.env.PORT ?? '4000', 10),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  appUrl: process.env.APP_URL ?? 'http://localhost:4000',
  appUrl: defaultAppUrl(),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  logLevel: process.env.LOG_LEVEL ?? 'debug',
  database: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/mergefi',
    synchronize: process.env.DATABASE_SYNCHRONIZE === 'true',
    logging: process.env.DATABASE_LOGGING === 'true',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'insecure-dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || 'mock_client_id_12345',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || 'mock_secret_key_67890',
    oauthCallbackUrl:
      process.env.GITHUB_OAUTH_CALLBACK_URL ||
      `${defaultAppUrl().replace(/\/$/, '')}/api/auth/github/callback`,
    apiToken: process.env.GITHUB_API_TOKEN ?? '',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
    syncAllowedRepos: process.env.GITHUB_SYNC_ALLOWED_REPOS ?? '',
  },

  analytics: {
    platformSummaryTtlMs: parseInt(
      process.env.ANALYTICS_PLATFORM_SUMMARY_TTL_MS ?? '60000',
      10,
    ),
  },
  stellar: {
    network: process.env.STELLAR_NETWORK ?? 'testnet',
    sorobanRpcUrl:
      process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    networkPassphrase:
      process.env.STELLAR_NETWORK_PASSPHRASE ??
      'Test SDF Network ; September 2015',
    escrowContractId: process.env.ESCROW_CONTRACT_ID ?? '',
    maintenancePoolContractId:
      process.env.MAINTENANCE_POOL_CONTRACT_ID ?? '',
    treasurySecret: process.env.TREASURY_SECRET ?? '',
    dryRun: process.env.SOROBAN_DRY_RUN === 'true',
    inclusionFee: Number(
      process.env.SOROBAN_INCLUSION_FEE ??
        String(DEFAULT_SOROBAN_INCLUSION_FEE),
    ),
    protocolFeeBps: Number(process.env.SOROBAN_FEE_BPS ?? '250'),
    assetContractIds: {
      USDC: process.env.USDC_TOKEN_CONTRACT_ID ?? '',
      XLM: process.env.XLM_TOKEN_CONTRACT_ID ?? '',
    },
    escrowDeadlineSeconds: parseInt(
      process.env.ESCROW_DEADLINE_SECONDS ?? '7776000',
      10,
    ),
  },
  schedulers: {
    enabled: parseSchedulersEnabled(process.env.RUN_SCHEDULERS),
  },
});
