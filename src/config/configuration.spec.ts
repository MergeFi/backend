import configuration, { AppConfig } from './configuration';
import { AssetType } from '../common/enums';

describe('AppConfig configuration loader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('loads default values when environment variables are unset', () => {
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    delete process.env.APP_URL;
    delete process.env.FRONTEND_URL;
    delete process.env.LOG_LEVEL;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_SYNCHRONIZE;
    delete process.env.DATABASE_LOGGING;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GITHUB_OAUTH_CALLBACK_URL;
    delete process.env.GITHUB_API_TOKEN;
    delete process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.GITHUB_SYNC_ALLOWED_REPOS;
    delete process.env.ANALYTICS_PLATFORM_SUMMARY_TTL_MS;
    delete process.env.STELLAR_NETWORK;
    delete process.env.SOROBAN_RPC_URL;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
    delete process.env.ESCROW_CONTRACT_ID;
    delete process.env.MAINTENANCE_POOL_CONTRACT_ID;
    delete process.env.TREASURY_SECRET;
    delete process.env.USDC_TOKEN_CONTRACT_ID;
    delete process.env.XLM_TOKEN_CONTRACT_ID;
    delete process.env.ESCROW_DEADLINE_SECONDS;

    const config: AppConfig = configuration();

    expect(config.env).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.appUrl).toBe('http://localhost:3000');
    expect(config.frontendUrl).toBe('http://localhost:3001');
    expect(config.logLevel).toBe('debug');
    expect(config.database.url).toBe(
      'postgresql://postgres:postgres@localhost:5432/mergefi',
    );
    expect(config.database.synchronize).toBe(false);
    expect(config.database.logging).toBe(false);
    expect(config.jwt.secret).toBe('insecure-dev-secret');
    expect(config.jwt.expiresIn).toBe('7d');
    expect(config.github.clientId).toBe('mock_client_id_12345');
    expect(config.github.clientSecret).toBe('mock_secret_key_67890');
    expect(config.github.oauthCallbackUrl).toBe(
      'http://localhost:3000/api/auth/github/callback',
    );
    expect(config.github.apiToken).toBe('');
    expect(config.github.webhookSecret).toBe('');
    expect(config.github.syncAllowedRepos).toBe('');
    expect(config.analytics.platformSummaryTtlMs).toBe(60000);
    expect(config.stellar.network).toBe('testnet');
    expect(config.stellar.sorobanRpcUrl).toBe(
      'https://soroban-testnet.stellar.org',
    );
    expect(config.stellar.networkPassphrase).toBe(
      'Test SDF Network ; September 2015',
    );
    expect(config.stellar.escrowContractId).toBe('');
    expect(config.stellar.maintenancePoolContractId).toBe('');
    expect(config.stellar.treasurySecret).toBe('');
    expect(config.stellar.assetContractIds[AssetType.USDC]).toBe('');
    expect(config.stellar.assetContractIds[AssetType.XLM]).toBe('');
    expect(config.stellar.escrowDeadlineSeconds).toBe(7776000);
  });

  it('correctly maps explicitly provided environment variables', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '8080';
    process.env.APP_URL = 'https://api.mergefi.xyz';
    process.env.FRONTEND_URL = 'https://mergefi.xyz';
    process.env.LOG_LEVEL = 'warn';
    process.env.DATABASE_URL = 'postgresql://user:pass@prod-db:5432/mergefi';
    process.env.DATABASE_SYNCHRONIZE = 'true';
    process.env.DATABASE_LOGGING = 'true';
    process.env.JWT_SECRET = 'super-secret-key';
    process.env.JWT_EXPIRES_IN = '1d';
    process.env.GITHUB_CLIENT_ID = 'live_client_id';
    process.env.GITHUB_CLIENT_SECRET = 'live_secret_key';
    process.env.GITHUB_OAUTH_CALLBACK_URL =
      'https://api.mergefi.xyz/api/auth/github/callback';
    process.env.GITHUB_API_TOKEN = 'ghp_token123';
    process.env.GITHUB_WEBHOOK_SECRET = 'whsec_xyz';
    process.env.GITHUB_SYNC_ALLOWED_REPOS = 'MergeFi/backend,MergeFi/frontend';
    process.env.ANALYTICS_PLATFORM_SUMMARY_TTL_MS = '120000';
    process.env.STELLAR_NETWORK = 'public';
    process.env.SOROBAN_RPC_URL = 'https://mainnet.sorobanrpc.com';
    process.env.STELLAR_NETWORK_PASSPHRASE =
      'Public Global Stellar Network ; September 2015';
    process.env.ESCROW_CONTRACT_ID = 'CA_ESCROW_CONTRACT';
    process.env.MAINTENANCE_POOL_CONTRACT_ID = 'CA_POOL_CONTRACT';
    process.env.TREASURY_SECRET = 'S_TREASURY_KEY';
    process.env.USDC_TOKEN_CONTRACT_ID = 'CA_USDC_CONTRACT';
    process.env.XLM_TOKEN_CONTRACT_ID = 'CA_XLM_CONTRACT';
    process.env.ESCROW_DEADLINE_SECONDS = '3600';

    const config: AppConfig = configuration();

    expect(config.env).toBe('production');
    expect(config.port).toBe(8080);
    expect(config.appUrl).toBe('https://api.mergefi.xyz');
    expect(config.frontendUrl).toBe('https://mergefi.xyz');
    expect(config.logLevel).toBe('warn');
    expect(config.database.url).toBe(
      'postgresql://user:pass@prod-db:5432/mergefi',
    );
    expect(config.database.synchronize).toBe(true);
    expect(config.database.logging).toBe(true);
    expect(config.jwt.secret).toBe('super-secret-key');
    expect(config.jwt.expiresIn).toBe('1d');
    expect(config.github.clientId).toBe('live_client_id');
    expect(config.github.clientSecret).toBe('live_secret_key');
    expect(config.github.oauthCallbackUrl).toBe(
      'https://api.mergefi.xyz/api/auth/github/callback',
    );
    expect(config.github.apiToken).toBe('ghp_token123');
    expect(config.github.webhookSecret).toBe('whsec_xyz');
    expect(config.github.syncAllowedRepos).toBe(
      'MergeFi/backend,MergeFi/frontend',
    );
    expect(config.analytics.platformSummaryTtlMs).toBe(120000);
    expect(config.stellar.network).toBe('public');
    expect(config.stellar.sorobanRpcUrl).toBe('https://mainnet.sorobanrpc.com');
    expect(config.stellar.networkPassphrase).toBe(
      'Public Global Stellar Network ; September 2015',
    );
    expect(config.stellar.escrowContractId).toBe('CA_ESCROW_CONTRACT');
    expect(config.stellar.maintenancePoolContractId).toBe('CA_POOL_CONTRACT');
    expect(config.stellar.treasurySecret).toBe('S_TREASURY_KEY');
    expect(config.stellar.assetContractIds[AssetType.USDC]).toBe(
      'CA_USDC_CONTRACT',
    );
    expect(config.stellar.assetContractIds[AssetType.XLM]).toBe(
      'CA_XLM_CONTRACT',
    );
    expect(config.stellar.escrowDeadlineSeconds).toBe(3600);
  });

  it('handles empty-string environment variables and || vs ?? distinctions', () => {
    // Fields using || will fall back to defaults when assigned ''
    process.env.GITHUB_CLIENT_ID = '';
    process.env.GITHUB_CLIENT_SECRET = '';
    process.env.GITHUB_OAUTH_CALLBACK_URL = '';

    // Fields using ?? will preserve ''
    process.env.GITHUB_API_TOKEN = '';
    process.env.GITHUB_WEBHOOK_SECRET = '';
    process.env.ESCROW_CONTRACT_ID = '';

    const config: AppConfig = configuration();

    expect(config.github.clientId).toBe('mock_client_id_12345');
    expect(config.github.clientSecret).toBe('mock_secret_key_67890');
    expect(config.github.oauthCallbackUrl).toBe(
      'http://localhost:3000/api/auth/github/callback',
    );

    expect(config.github.apiToken).toBe('');
    expect(config.github.webhookSecret).toBe('');
    expect(config.stellar.escrowContractId).toBe('');
  });

  it('yields NaN for non-numeric integer configurations', () => {
    process.env.PORT = 'not-a-number';
    process.env.ESCROW_DEADLINE_SECONDS = 'invalid-deadline';
    process.env.ANALYTICS_PLATFORM_SUMMARY_TTL_MS = 'bad-ttl';

    const config: AppConfig = configuration();

    expect(Number.isNaN(config.port)).toBe(true);
    expect(Number.isNaN(config.stellar.escrowDeadlineSeconds)).toBe(true);
    expect(Number.isNaN(config.analytics.platformSummaryTtlMs)).toBe(true);
  });

  it('falls back maintenancePoolContractId to escrowContractId when unset', () => {
    delete process.env.MAINTENANCE_POOL_CONTRACT_ID;
    process.env.ESCROW_CONTRACT_ID = 'CA_SHARED_ESCROW_DEPLOYMENT';

    const config: AppConfig = configuration();

    expect(config.stellar.escrowContractId).toBe(
      'CA_SHARED_ESCROW_DEPLOYMENT',
    );
    expect(config.stellar.maintenancePoolContractId).toBe(
      'CA_SHARED_ESCROW_DEPLOYMENT',
    );
  });

  it('prefers explicit maintenancePoolContractId over escrowContractId', () => {
    process.env.MAINTENANCE_POOL_CONTRACT_ID = 'CA_DEDICATED_POOL_DEPLOYMENT';
    process.env.ESCROW_CONTRACT_ID = 'CA_SHARED_ESCROW_DEPLOYMENT';

    const config: AppConfig = configuration();

    expect(config.stellar.escrowContractId).toBe(
      'CA_SHARED_ESCROW_DEPLOYMENT',
    );
    expect(config.stellar.maintenancePoolContractId).toBe(
      'CA_DEDICATED_POOL_DEPLOYMENT',
    );
  });
});
