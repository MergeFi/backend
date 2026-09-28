import {
  collectConfigIssues,
  assertRequiredConfig,
  INSECURE_DEFAULT_JWT_SECRET,
  DEFAULT_LOCAL_DATABASE_URL,
} from './validate-required-config';

describe('validate-required-config', () => {
  const validProductionConfig = {
    env: 'production',
    jwt: { secret: 'super-secure-production-jwt-secret-xyz123' },
    database: {
      url: 'postgresql://prod_user:prod_pass@db.example.com:5432/mergefi_prod',
      synchronize: false,
    },
    github: {
      clientId: 'gh_client_123',
      clientSecret: 'gh_secret_456',
      webhookSecret: 'gh_webhook_789',
    },
    stellar: {
      escrowContractId: 'CA...',
      treasurySecret: 'SA...',
    },
  };

  it('returns no issues when production config is valid and synchronize is false', () => {
    const issues = collectConfigIssues(validProductionConfig as any);
    expect(issues).toHaveLength(0);
  });

  it('ignores issues outside production even with dev defaults', () => {
    const devConfig = {
      ...validProductionConfig,
      env: 'development',
      jwt: { secret: INSECURE_DEFAULT_JWT_SECRET },
      database: {
        url: DEFAULT_LOCAL_DATABASE_URL,
        synchronize: true,
      },
    };
    const issues = collectConfigIssues(devConfig as any);
    expect(issues).toHaveLength(0);
  });

  it('detects DATABASE_SYNCHRONIZE=true in production', () => {
    const config = {
      ...validProductionConfig,
      database: {
        ...validProductionConfig.database,
        synchronize: true,
      },
    };
    const issues = collectConfigIssues(config as any);
    expect(issues.some((i) => i.key === 'DATABASE_SYNCHRONIZE')).toBe(true);
    expect(() => assertRequiredConfig(config as any)).toThrow(
      /DATABASE_SYNCHRONIZE is enabled in production/,
    );
  });

  it('detects missing secrets and dev database URL in production', () => {
    const config = {
      ...validProductionConfig,
      jwt: { secret: INSECURE_DEFAULT_JWT_SECRET },
      database: {
        url: DEFAULT_LOCAL_DATABASE_URL,
        synchronize: false,
      },
      github: {
        clientId: '',
        clientSecret: '',
        webhookSecret: '',
      },
      stellar: {
        escrowContractId: '',
        treasurySecret: '',
      },
    };
    const issues = collectConfigIssues(config as any);
    expect(issues.map((i) => i.key)).toEqual(
      expect.arrayContaining([
        'JWT_SECRET',
        'DATABASE_URL',
        'GITHUB_WEBHOOK_SECRET',
        'GITHUB_CLIENT_ID',
        'GITHUB_CLIENT_SECRET',
        'ESCROW_CONTRACT_ID',
        'TREASURY_SECRET',
      ]),
    );
  });
});
