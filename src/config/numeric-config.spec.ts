import configuration, { parsePositiveIntegerEnv } from './configuration';
import {
  collectConfigIssues,
  assertRequiredConfig,
} from './validate-required-config';

describe('Numeric Configuration Validation (#610)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('parsePositiveIntegerEnv', () => {
    it('returns parsed integer for valid positive integer strings', () => {
      expect(parsePositiveIntegerEnv('3000', 8080, 'PORT')).toBe(3000);
      expect(
        parsePositiveIntegerEnv('7776000', 3600, 'ESCROW_DEADLINE_SECONDS'),
      ).toBe(7776000);
      expect(
        parsePositiveIntegerEnv(
          '60000',
          1000,
          'ANALYTICS_PLATFORM_SUMMARY_TTL_MS',
        ),
      ).toBe(60000);
    });

    it('returns default value when input is undefined or empty/whitespace', () => {
      expect(parsePositiveIntegerEnv(undefined, 3000, 'PORT')).toBe(3000);
      expect(parsePositiveIntegerEnv('', 3000, 'PORT')).toBe(3000);
      expect(parsePositiveIntegerEnv('   ', 3000, 'PORT')).toBe(3000);
    });

    it('throws descriptive error on alphanumeric typos (like 90d)', () => {
      expect(() =>
        parsePositiveIntegerEnv('90d', 7776000, 'ESCROW_DEADLINE_SECONDS'),
      ).toThrow(
        'Invalid environment variable ESCROW_DEADLINE_SECONDS: expected a positive integer, got "90d"',
      );

      expect(() => parsePositiveIntegerEnv('abc', 3000, 'PORT')).toThrow(
        'Invalid environment variable PORT: expected a positive integer, got "abc"',
      );
    });

    it('throws on zero, negative integers, and decimals', () => {
      expect(() => parsePositiveIntegerEnv('0', 3000, 'PORT')).toThrow(
        'Invalid environment variable PORT: expected a positive integer, got "0"',
      );

      expect(() => parsePositiveIntegerEnv('-1', 3000, 'PORT')).toThrow(
        'Invalid environment variable PORT: expected a positive integer, got "-1"',
      );

      expect(() => parsePositiveIntegerEnv('3000.5', 3000, 'PORT')).toThrow(
        'Invalid environment variable PORT: expected a positive integer, got "3000.5"',
      );
    });
  });

  describe('configuration() boot fail-fast', () => {
    it('throws immediately when ESCROW_DEADLINE_SECONDS is misconfigured', () => {
      process.env.ESCROW_DEADLINE_SECONDS = '90d';
      expect(() => configuration()).toThrow(
        'Invalid environment variable ESCROW_DEADLINE_SECONDS: expected a positive integer, got "90d"',
      );
    });

    it('throws immediately when PORT is misconfigured', () => {
      process.env.PORT = 'invalid-port';
      expect(() => configuration()).toThrow(
        'Invalid environment variable PORT: expected a positive integer, got "invalid-port"',
      );
    });

    it('throws immediately when ANALYTICS_PLATFORM_SUMMARY_TTL_MS is misconfigured', () => {
      process.env.ANALYTICS_PLATFORM_SUMMARY_TTL_MS = '-50';
      expect(() => configuration()).toThrow(
        'Invalid environment variable ANALYTICS_PLATFORM_SUMMARY_TTL_MS: expected a positive integer, got "-50"',
      );
    });
  });

  describe('collectConfigIssues & assertRequiredConfig in production', () => {
    const validProdConfig = {
      env: 'production',
      jwt: { secret: 'super-long-secure-random-jwt-secret-key-12345' },
      github: {
        clientId: 'real_client_id',
        clientSecret: 'real_client_secret',
        webhookSecret: 'real_webhook_secret',
      },
      stellar: {
        escrowContractId: 'CA_ESCROW_REAL_CONTRACT',
        treasurySecret: 'S_REAL_TREASURY_SECRET',
        escrowDeadlineSeconds: 7776000,
      },
      database: {
        url: 'postgresql://prod_user:secret_pass@prod-cluster:5432/mergefi',
      },
    };

    it('passes when escrowDeadlineSeconds is a valid positive integer', () => {
      const issues = collectConfigIssues(validProdConfig);
      expect(issues).toEqual([]);
      expect(() => assertRequiredConfig(validProdConfig)).not.toThrow();
    });

    it('catches non-positive or NaN escrowDeadlineSeconds in production', () => {
      const invalidConfig = {
        ...validProdConfig,
        stellar: {
          ...validProdConfig.stellar,
          escrowDeadlineSeconds: NaN,
        },
      };

      const issues = collectConfigIssues(invalidConfig);
      expect(issues).toContainEqual({
        key: 'ESCROW_DEADLINE_SECONDS',
        message:
          'ESCROW_DEADLINE_SECONDS must be a positive integer — escrow deadline cannot be computed',
      });

      expect(() => assertRequiredConfig(invalidConfig)).toThrow(
        'ESCROW_DEADLINE_SECONDS must be a positive integer',
      );
    });
  });
});
