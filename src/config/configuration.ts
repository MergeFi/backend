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
     * carries no explicit deadline of its own (#158). The contract's
     * refund-after-deadline mechanism depends on this being set.
     */
    escrowDeadlineSeconds: number;
  };
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',
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
    clientId: process.env.GITHUB_CLIENT_ID ?? '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    oauthCallbackUrl:
      process.env.GITHUB_OAUTH_CALLBACK_URL ??
      'http://localhost:3000/api/auth/github/callback',
    apiToken: process.env.GITHUB_API_TOKEN ?? '',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
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
    escrowDeadlineSeconds: parseInt(
      process.env.ESCROW_DEADLINE_SECONDS ?? '7776000',
      10,
    ),
  },
});
