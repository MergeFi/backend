export interface AppConfig {
  env: string;
  port: number;
  appUrl: string;
  frontendUrl: string;
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
  stellar: {
    network: string;
    horizonUrl: string;
    sorobanRpcUrl: string;
    networkPassphrase: string;
    escrowContractId: string;
    maintenancePoolContractId: string;
    treasuryAddress: string;
    treasurySecret: string;
    usdcAssetCode: string;
    usdcAssetIssuer: string;
  };
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',
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
  stellar: {
    network: process.env.STELLAR_NETWORK ?? 'testnet',
    horizonUrl:
      process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
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
    treasuryAddress: process.env.TREASURY_ADDRESS ?? '',
    treasurySecret: process.env.TREASURY_SECRET ?? '',
    usdcAssetCode: process.env.USDC_ASSET_CODE ?? 'USDC',
    usdcAssetIssuer: process.env.USDC_ASSET_ISSUER ?? '',
  },
});
