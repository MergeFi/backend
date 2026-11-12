import configuration from './configuration';

const ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'DATABASE_SYNCHRONIZE',
  'DATABASE_LOGGING',
  'JWT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_WEBHOOK_SECRET',
  'ANALYTICS_PLATFORM_SUMMARY_TTL_MS',
  'ESCROW_CONTRACT_ID',
  'MAINTENANCE_POOL_CONTRACT_ID',
  'ESCROW_DEADLINE_SECONDS',
  'USDC_TOKEN_CONTRACT_ID',
  'XLM_TOKEN_CONTRACT_ID',
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

  it('throws for a non-numeric, non-positive or out-of-range PORT', () => {
    process.env.PORT = 'abc';
    expect(() => configuration()).toThrow(/PORT must be a positive integer/);

    process.env.PORT = '0';
    expect(() => configuration()).toThrow(/PORT must be a positive integer/);

    process.env.PORT = '-1';
    expect(() => configuration()).toThrow(/PORT must be a positive integer/);

    process.env.PORT = '65536';
    expect(() => configuration()).toThrow(/PORT must be a positive integer/);

    process.env.PORT = '80.5';
    expect(() => configuration()).toThrow(/PORT must be a positive integer/);
  });

  it('throws for a non-numeric, non-positive or below-minimum ESCROW_DEADLINE_SECONDS', () => {
    process.env.ESCROW_DEADLINE_SECONDS = 'soon';
    expect(() => configuration()).toThrow(
      /ESCROW_DEADLINE_SECONDS must be a positive integer/,
    );

    process.env.ESCROW_DEADLINE_SECONDS = '0';
    expect(() => configuration()).toThrow(
      /ESCROW_DEADLINE_SECONDS must be a positive integer/,
    );

    process.env.ESCROW_DEADLINE_SECONDS = '-10';
    expect(() => configuration()).toThrow(
      /ESCROW_DEADLINE_SECONDS must be a positive integer/,
    );

    process.env.ESCROW_DEADLINE_SECONDS = '1.5';
    expect(() => configuration()).toThrow(
      /ESCROW_DEADLINE_SECONDS must be a positive integer/,
    );
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
});
