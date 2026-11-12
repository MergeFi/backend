import { AssetType } from '../common/enums';

export interface AppConfig {
  env: string;
  port: number;
  appUrl: string;
  frontendUrl: string;
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
    /**
     * Soroban token (SAC) contract addresses per supported asset. The real
     * `escrow::fund(issue_id, sponsor, token, amount, deadline)` takes the
     * token contract as a required argument (#158); this is where that
     * address is resolved from `Escrow.asset`. Left blank in environments
     * with no deployed contracts (calls dry-run regardless).
     */
    assetContractIds: Record<AssetType, string>;
    /**
     * Fallback escrow deadline, in seconds from fund time, used as the real
     * `escrow::fund`'s `deadline` argument when the funding bounty/milestone
     * carries no explicit deadline of its own (#158).
     *
     * In the deployed smart contract, once `now >= deadline + GRACE_PERIOD`
     * (14 days), `escrow::refund` becomes permissionless — anyone can trigger
     * it to unwind the escrow and return funds to contributors on record.
     * Shortening this setting creates an early on-chain permissionless refund
     * window (e.g. 7 days yields an unwinding window at day 21) that can unwind
     * bounties the platform still considers live (#851).
     */
    escrowDeadlineSeconds: number;
  };
}

export const DEFAULT_PORT = 4000;
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

export const DEFAULT_ESCROW_DEADLINE_SECONDS = 7776000; // 90 days
export const MIN_ESCROW_DEADLINE_SECONDS = 1;

export function parsePort(val: string | undefined): number {
  if (val === undefined) return DEFAULT_PORT;
  const num = Number(val);
  if (!Number.isInteger(num) || num < MIN_PORT || num > MAX_PORT) {
    throw new Error(
      `PORT must be a positive integer between ${MIN_PORT} and ${MAX_PORT}, received "${val}"`,
    );
  }
  return num;
}

export function parseEscrowDeadlineSeconds(val: string | undefined): number {
  if (val === undefined) return DEFAULT_ESCROW_DEADLINE_SECONDS;
  const num = Number(val);
  if (!Number.isInteger(num) || num < MIN_ESCROW_DEADLINE_SECONDS) {
    throw new Error(
      `ESCROW_DEADLINE_SECONDS must be a positive integer (minimum ${MIN_ESCROW_DEADLINE_SECONDS} second), received "${val}"`,
    );
  }
  return num;
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parsePort(process.env.PORT),
  appUrl: process.env.APP_URL ?? 'http://localhost:4000',
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
      'http://localhost:3000/api/auth/github/callback',
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
      process.env.MAINTENANCE_POOL_CONTRACT_ID ??
      process.env.ESCROW_CONTRACT_ID ??
      '',
    treasurySecret: process.env.TREASURY_SECRET ?? '',
    assetContractIds: {
      USDC: process.env.USDC_TOKEN_CONTRACT_ID ?? '',
      XLM: process.env.XLM_TOKEN_CONTRACT_ID ?? '',
    },
    escrowDeadlineSeconds: parseEscrowDeadlineSeconds(
      process.env.ESCROW_DEADLINE_SECONDS,
    ),
  },
});
