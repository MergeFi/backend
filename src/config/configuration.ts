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
  stellar: {
    network: string;
    sorobanRpcUrl: string;
    networkPassphrase: string;
    escrowContractId: string;
    treasurySecret: string;
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
  stellar: {
    network: process.env.STELLAR_NETWORK ?? 'testnet',
    sorobanRpcUrl:
      process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    networkPassphrase:
      process.env.STELLAR_NETWORK_PASSPHRASE ??
      'Test SDF Network ; September 2015',
    escrowContractId: process.env.ESCROW_CONTRACT_ID ?? '',
    treasurySecret: process.env.TREASURY_SECRET ?? '',
  },
});
