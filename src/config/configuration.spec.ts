import configuration from './configuration';

describe('configuration (#601)', () => {
  const ORIG = process.env;
  beforeEach(() => {
    process.env = { ...ORIG };
  });
  afterAll(() => {
    process.env = ORIG;
  });

  it('uses dev defaults when env is unset', () => {
    delete process.env.PORT;
    const cfg = configuration();
    expect(cfg.env).toBe('development');
    expect(cfg.jwt.secret).toBe('insecure-dev-secret');
    expect(cfg.stellar.network).toBe('testnet');
  });

  it('parses integer env vars', () => {
    process.env.PORT = '9000';
    process.env.ESCROW_DEADLINE_SECONDS = '3600';
    const cfg = configuration();
    expect(cfg.port).toBe(9000);
    expect(cfg.stellar.escrowDeadlineSeconds).toBe(3600);
  });

  it('parses boolean env vars strictly (=== "true")', () => {
    process.env.DATABASE_SYNCHRONIZE = 'true';
    process.env.DATABASE_LOGGING = 'false';
    const cfg = configuration();
    expect(cfg.database.synchronize).toBe(true);
    expect(cfg.database.logging).toBe(false);
  });

  it('falls back MAINTENANCE_POOL_CONTRACT_ID to ESCROW_CONTRACT_ID', () => {
    delete process.env.MAINTENANCE_POOL_CONTRACT_ID;
    process.env.ESCROW_CONTRACT_ID = 'escrow-abc';
    expect(configuration().stellar.maintenancePoolContractId).toBe(
      'escrow-abc',
    );
  });

  it('prefers MAINTENANCE_POOL_CONTRACT_ID over the escrow fallback', () => {
    process.env.MAINTENANCE_POOL_CONTRACT_ID = 'pool-xyz';
    process.env.ESCROW_CONTRACT_ID = 'escrow-abc';
    expect(configuration().stellar.maintenancePoolContractId).toBe('pool-xyz');
  });

  it('reads the per-asset contract ids', () => {
    process.env.USDC_TOKEN_CONTRACT_ID = 'usdc-1';
    process.env.XLM_TOKEN_CONTRACT_ID = 'xlm-1';
    const cfg = configuration();
    expect(cfg.stellar.assetContractIds.USDC).toBe('usdc-1');
    expect(cfg.stellar.assetContractIds.XLM).toBe('xlm-1');
  });
});
