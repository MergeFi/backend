import {
  collectConfigIssues,
  assertRequiredConfig,
  INSECURE_DEFAULT_JWT_SECRET,
  DEFAULT_LOCAL_DATABASE_URL,
} from './validate-required-config';

describe('validate-required-config', () => {
  const validProductionConfig = {
    env: 'production',
    jwt: {
      secret: 'super-secure-production-jwt-secret-xyz123',
    },
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
      escrowContractId: 'CA_ESCROW_CONTRACT_ADDRESS',
      treasurySecret: 'S_TREASURY_SIGNER_KEY',
    },
  };

  describe('valid configurations', () => {
    it('returns no issues when production config is fully satisfied and synchronize is false', () => {
      const issues = collectConfigIssues(validProductionConfig as any);
      expect(issues).toHaveLength(0);
      expect(() => assertRequiredConfig(validProductionConfig as any)).not.toThrow();
    });

    it('acts as a no-op outside production environment even with dev defaults and missing secrets', () => {
      const devEnvironments = ['development', 'test', 'local', 'staging'];

      for (const env of devEnvironments) {
        const devConfig = {
          env,
          jwt: { secret: INSECURE_DEFAULT_JWT_SECRET },
          database: {
            url: DEFAULT_LOCAL_DATABASE_URL,
            synchronize: true,
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

        const issues = collectConfigIssues(devConfig as any);
        expect(issues).toHaveLength(0);
        expect(() => assertRequiredConfig(devConfig as any)).not.toThrow();
      }
    });
  });

  describe('database safety guards (#325)', () => {
    it('detects DATABASE_SYNCHRONIZE=true in production', () => {
      const config = {
        ...validProductionConfig,
        database: {
          ...validProductionConfig.database,
          synchronize: true,
        },
      };

      const issues = collectConfigIssues(config as any);
      const syncIssue = issues.find((i) => i.key === 'DATABASE_SYNCHRONIZE');
      expect(syncIssue).toBeDefined();
      expect(syncIssue?.message).toContain('DATABASE_SYNCHRONIZE is enabled in production');

      expect(() => assertRequiredConfig(config as any)).toThrow(
        /DATABASE_SYNCHRONIZE is enabled in production/,
      );
    });

    it('detects default local database URL in production', () => {
      const config = {
        ...validProductionConfig,
        database: {
          url: DEFAULT_LOCAL_DATABASE_URL,
          synchronize: false,
        },
      };

      const issues = collectConfigIssues(config as any);
      const dbIssue = issues.find((i) => i.key === 'DATABASE_URL');
      expect(dbIssue).toBeDefined();
      expect(dbIssue?.message).toContain('localhost:5432');
    });

    it('detects missing or empty database URL in production', () => {
      const config = {
        ...validProductionConfig,
        database: {
          url: '',
          synchronize: false,
        },
      };

      const issues = collectConfigIssues(config as any);
      const dbIssue = issues.find((i) => i.key === 'DATABASE_URL');
      expect(dbIssue).toBeDefined();
    });
  });

  describe('jwt and secret enforcement (#153)', () => {
    it('detects the insecure default JWT secret in production', () => {
      const config = {
        ...validProductionConfig,
        jwt: { secret: INSECURE_DEFAULT_JWT_SECRET },
      };

      const issues = collectConfigIssues(config as any);
      const jwtIssue = issues.find((i) => i.key === 'JWT_SECRET');
      expect(jwtIssue).toBeDefined();
      expect(jwtIssue?.message).toContain('insecure dev default');
    });

    it('detects missing or whitespace-only JWT secret in production', () => {
      const config = {
        ...validProductionConfig,
        jwt: { secret: '   ' },
      };

      const issues = collectConfigIssues(config as any);
      const jwtIssue = issues.find((i) => i.key === 'JWT_SECRET');
      expect(jwtIssue).toBeDefined();
      expect(jwtIssue?.message).toContain('session tokens cannot be signed');
    });

    it.each([
      ['GITHUB_WEBHOOK_SECRET', 'github', 'webhookSecret'],
      ['GITHUB_CLIENT_ID', 'github', 'clientId'],
      ['GITHUB_CLIENT_SECRET', 'github', 'clientSecret'],
      ['ESCROW_CONTRACT_ID', 'stellar', 'escrowContractId'],
      ['TREASURY_SECRET', 'stellar', 'treasurySecret'],
    ])('flags missing secret %s in production', (key, section, prop) => {
      const config = {
        ...validProductionConfig,
        [section]: {
          ...(validProductionConfig as any)[section],
          [prop]: '',
        },
      };

      const issues = collectConfigIssues(config as any);
      expect(issues.some((i) => i.key === key)).toBe(true);
    });
  });

  describe('assertRequiredConfig error aggregation', () => {
    it('aggregates all missing configuration items into a single descriptive startup error', () => {
      const strippedConfig = {
        env: 'production',
        jwt: { secret: INSECURE_DEFAULT_JWT_SECRET },
        database: {
          url: DEFAULT_LOCAL_DATABASE_URL,
          synchronize: true,
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

      expect(() => assertRequiredConfig(strippedConfig as any)).toThrow(
        /Refusing to start in production with an incomplete configuration:/,
      );

      try {
        assertRequiredConfig(strippedConfig as any);
      } catch (err: any) {
        expect(err.message).toContain('JWT_SECRET');
        expect(err.message).toContain('DATABASE_URL');
        expect(err.message).toContain('DATABASE_SYNCHRONIZE');
        expect(err.message).toContain('GITHUB_WEBHOOK_SECRET');
        expect(err.message).toContain('GITHUB_CLIENT_ID');
        expect(err.message).toContain('GITHUB_CLIENT_SECRET');
        expect(err.message).toContain('ESCROW_CONTRACT_ID');
        expect(err.message).toContain('TREASURY_SECRET');
      }
    });
  });
});
