import {
  collectConfigIssues,
  assertRequiredConfig,
  RequiredConfig,
  INSECURE_DEFAULT_JWT_SECRET,
  DEFAULT_LOCAL_DATABASE_URL,
} from './validate-required-config';

const prodConfig = (over: Partial<RequiredConfig> = {}): RequiredConfig =>
  ({
    env: 'production',
    port: 3000,
    jwt: { secret: 'a-real-secret' },
    database: { url: 'postgresql://prod-host/db' },
    github: {
      clientId: 'cid',
      clientSecret: 'csec',
      webhookSecret: 'whsec',
    },
    stellar: {
      escrowContractId: 'CESCROW',
      treasurySecret: 'STREAS',
    },
    ...over,
  }) as RequiredConfig;

describe('collectConfigIssues', () => {
  it('returns no issues for a complete production config', () => {
    expect(collectConfigIssues(prodConfig())).toEqual([]);
  });

  it('returns no issues outside production', () => {
    const dev = prodConfig({
      env: 'development',
      jwt: { secret: '' },
      github: { clientId: '', clientSecret: '', webhookSecret: '' },
    } as Partial<RequiredConfig>);
    expect(collectConfigIssues(dev)).toEqual([]);
  });

  it('flags the insecure default JWT secret', () => {
    const issues = collectConfigIssues(
      prodConfig({ jwt: { secret: INSECURE_DEFAULT_JWT_SECRET } } as any),
    );
    expect(issues.some((i) => i.key === 'JWT_SECRET')).toBe(true);
  });

  it('flags a missing/blank JWT secret', () => {
    const issues = collectConfigIssues(
      prodConfig({ jwt: { secret: '   ' } } as any),
    );
    expect(issues.some((i) => i.key === 'JWT_SECRET')).toBe(true);
  });

  it('flags the default local DATABASE_URL', () => {
    const issues = collectConfigIssues(
      prodConfig({ database: { url: DEFAULT_LOCAL_DATABASE_URL } } as any),
    );
    expect(issues.some((i) => i.key === 'DATABASE_URL')).toBe(true);
  });

  it('flags missing escrow contract + treasury secret', () => {
    const issues = collectConfigIssues(
      prodConfig({
        stellar: { escrowContractId: '', treasurySecret: '' },
      } as any),
    );
    const keys = issues.map((i) => i.key);
    expect(keys).toContain('ESCROW_CONTRACT_ID');
    expect(keys).toContain('TREASURY_SECRET');
  });
});

describe('assertRequiredConfig', () => {
  it('does not throw for a valid production config', () => {
    expect(() => assertRequiredConfig(prodConfig())).not.toThrow();
  });

  it('throws listing every problem at once', () => {
    expect(() =>
      assertRequiredConfig(
        prodConfig({
          jwt: { secret: '' },
          stellar: { escrowContractId: '', treasurySecret: '' },
        } as any),
      ),
    ).toThrow(/Refusing to start/);
  });
});
