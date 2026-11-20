import configuration, { parseSchedulersEnabled } from './configuration';

const ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'APP_URL',
  'FRONTEND_URL',
  'DATABASE_URL',
  'DATABASE_SYNCHRONIZE',
  'DATABASE_LOGGING',
  'JWT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_OAUTH_CALLBACK_URL',
  'GITHUB_WEBHOOK_SECRET',
  'ANALYTICS_PLATFORM_SUMMARY_TTL_MS',
  'ESCROW_CONTRACT_ID',
  'MAINTENANCE_POOL_CONTRACT_ID',
  'ESCROW_DEADLINE_SECONDS',
  'USDC_TOKEN_CONTRACT_ID',
  'XLM_TOKEN_CONTRACT_ID',
  'GITHUB_SYNC_ALLOWED_REPOS',
  'RUN_SCHEDULERS',
];

describe('configuration', () => {
  const original = { ...process.env };

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterAll(() => {
    process.env = original;
  });

  it('falls back to defaults when nothing is set', () => {
    const config = configuration();
    expect(config.env).toBe('development');
    expect(config.port).toBe(4000);
    expect(config.database).toEqual({
      url: 'postgresql://postgres:postgres@localhost:5432/mergefi',
      synchronize: false,
      logging: false,
    });
    expect(config.jwt.secret).toBe('insecure-dev-secret');
    expect(config.github.webhookSecret).toBe('');
    expect(config.analytics.platformSummaryTtlMs).toBe(60000);
    expect(config.stellar.escrowDeadlineSeconds).toBe(7776000);
    expect(config.stellar.assetContractIds).toEqual({ USDC: '', XLM: '' });
    expect(config.github.oauthCallbackUrl).toBe(
      'http://localhost:4000/api/auth/github/callback',
    );
  });

  it('derives the OAuth callback from APP_URL when no override is set', () => {
    process.env.APP_URL = 'https://api.example.com/';

    expect(configuration().github.oauthCallbackUrl).toBe(
      'https://api.example.com/api/auth/github/callback',
    );
  });

  it('derives the default backend URL from PORT when APP_URL is unset', () => {
    process.env.PORT = '5000';

    expect(configuration().github.oauthCallbackUrl).toBe(
      'http://localhost:5000/api/auth/github/callback',
    );
  });

  it('uses GITHUB_OAUTH_CALLBACK_URL when explicitly configured', () => {
    process.env.GITHUB_OAUTH_CALLBACK_URL =
      'https://auth.example.com/api/auth/github/callback';

    expect(configuration().github.oauthCallbackUrl).toBe(
      'https://auth.example.com/api/auth/github/callback',
    );
  });

  it('parses integers and booleans from the environment', () => {
    process.env.PORT = '8080';
    process.env.ESCROW_DEADLINE_SECONDS = '120';
    process.env.DATABASE_SYNCHRONIZE = 'true';
    process.env.DATABASE_LOGGING = 'false';
    const config = configuration();
    expect(config.port).toBe(8080);
    expect(config.stellar.escrowDeadlineSeconds).toBe(120);
    expect(config.database.synchronize).toBe(true);
    expect(config.database.logging).toBe(false);
  });

  it('only treats the exact string "true" as a true boolean', () => {
    process.env.DATABASE_SYNCHRONIZE = '1';
    expect(configuration().database.synchronize).toBe(false);
  });

  it('keeps an empty-string env var where ?? is used, but falls back where || is used', () => {
    process.env.JWT_SECRET = '';
    process.env.GITHUB_CLIENT_ID = '';
    const config = configuration();
    expect(config.jwt.secret).toBe('');
    expect(config.github.clientId).toBe('mock_client_id_12345');
  });

  it('yields NaN for a non-numeric PORT or ESCROW_DEADLINE_SECONDS', () => {
    process.env.PORT = 'abc';
    process.env.ESCROW_DEADLINE_SECONDS = 'soon';
    const config = configuration();
    expect(config.port).toBeNaN();
    expect(config.stellar.escrowDeadlineSeconds).toBeNaN();
  });

  describe('maintenancePoolContractId', () => {
    it('falls back to ESCROW_CONTRACT_ID when unset', () => {
      process.env.ESCROW_CONTRACT_ID = 'CESCROW';
      expect(configuration().stellar.maintenancePoolContractId).toBe('CESCROW');
    });

    it('prefers MAINTENANCE_POOL_CONTRACT_ID when set', () => {
      process.env.ESCROW_CONTRACT_ID = 'CESCROW';
      process.env.MAINTENANCE_POOL_CONTRACT_ID = 'CPOOL';
      expect(configuration().stellar.maintenancePoolContractId).toBe('CPOOL');
    });

    it('is empty when neither is set', () => {
      expect(configuration().stellar.maintenancePoolContractId).toBe('');
    });
  });

  describe('github.syncAllowedRepos', () => {
    it('is empty when GITHUB_SYNC_ALLOWED_REPOS is unset', () => {
      expect(configuration().github.syncAllowedRepos).toBe('');
    });

    it('passes GITHUB_SYNC_ALLOWED_REPOS through verbatim', () => {
      process.env.GITHUB_SYNC_ALLOWED_REPOS = 'MergeFi/backend, MergeFi/web';
      expect(configuration().github.syncAllowedRepos).toBe(
        'MergeFi/backend, MergeFi/web',
      );
    });
  });

  describe('schedulers.enabled', () => {
    it('is enabled when RUN_SCHEDULERS is unset', () => {
      expect(configuration().schedulers.enabled).toBe(true);
    });

    it('is disabled by RUN_SCHEDULERS=false', () => {
      process.env.RUN_SCHEDULERS = 'false';
      expect(configuration().schedulers.enabled).toBe(false);
    });
  });

  describe('parseSchedulersEnabled', () => {
    it.each(['false', 'FALSE', ' False ', '0', 'no', 'NO', 'off', 'Off'])(
      'treats %p as disabled',
      (raw) => {
        expect(parseSchedulersEnabled(raw)).toBe(false);
      },
    );

    it.each([undefined, '', 'true', 'TRUE', '1', 'yes', 'on'])(
      'treats %p as enabled',
      (raw) => {
        expect(parseSchedulersEnabled(raw)).toBe(true);
      },
    );
  });
});
