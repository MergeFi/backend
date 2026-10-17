import configuration, { parsePort, parsePositiveInt } from './configuration';

describe('configuration validation (#610)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('parsePositiveInt', () => {
    it('returns fallback when raw is undefined or whitespace', () => {
      expect(parsePositiveInt(undefined, 7776000, 'ESCROW_DEADLINE_SECONDS')).toBe(
        7776000,
      );
      expect(parsePositiveInt('   ', 7776000, 'ESCROW_DEADLINE_SECONDS')).toBe(
        7776000,
      );
    });

    it('parses valid positive integer strings', () => {
      expect(parsePositiveInt('3600', 7776000, 'ESCROW_DEADLINE_SECONDS')).toBe(
        3600,
      );
      expect(
        parsePositiveInt('  86400  ', 7776000, 'ESCROW_DEADLINE_SECONDS'),
      ).toBe(86400);
    });

    it('throws descriptive error on non-numeric suffix (e.g. 90d)', () => {
      expect(() =>
        parsePositiveInt('90d', 7776000, 'ESCROW_DEADLINE_SECONDS'),
      ).toThrow(
        'Invalid configuration for ESCROW_DEADLINE_SECONDS: expected a positive integer, got "90d"',
      );
    });

    it('throws descriptive error on zero or negative numbers', () => {
      expect(() =>
        parsePositiveInt('0', 7776000, 'ESCROW_DEADLINE_SECONDS'),
      ).toThrow(
        'Invalid configuration for ESCROW_DEADLINE_SECONDS: expected a positive integer, got "0"',
      );
      expect(() =>
        parsePositiveInt('-100', 7776000, 'ESCROW_DEADLINE_SECONDS'),
      ).toThrow(
        'Invalid configuration for ESCROW_DEADLINE_SECONDS: expected a positive integer, got "-100"',
      );
    });

    it('throws descriptive error on non-integer strings', () => {
      expect(() =>
        parsePositiveInt('12.34', 7776000, 'ESCROW_DEADLINE_SECONDS'),
      ).toThrow(
        'Invalid configuration for ESCROW_DEADLINE_SECONDS: expected a positive integer, got "12.34"',
      );
    });
  });

  describe('parsePort', () => {
    it('returns fallback 3000 when undefined or whitespace', () => {
      expect(parsePort(undefined)).toBe(3000);
      expect(parsePort('')).toBe(3000);
    });

    it('parses valid ports within 1-65535', () => {
      expect(parsePort('8080')).toBe(8080);
      expect(parsePort('1')).toBe(1);
      expect(parsePort('65535')).toBe(65535);
    });

    it('throws error when port is out of range', () => {
      expect(() => parsePort('0')).toThrow(
        'Invalid configuration for PORT: expected a port number (1-65535), got "0"',
      );
      expect(() => parsePort('65536')).toThrow(
        'Invalid configuration for PORT: expected a port number (1-65535), got "65536"',
      );
      expect(() => parsePort('-1')).toThrow(
        'Invalid configuration for PORT: expected a port number (1-65535), got "-1"',
      );
    });

    it('throws error on non-numeric port strings', () => {
      expect(() => parsePort('invalid')).toThrow(
        'Invalid configuration for PORT: expected a port number (1-65535), got "invalid"',
      );
    });
  });

  describe('configuration() factory', () => {
    it('loads defaults when env variables are unset', () => {
      delete process.env.PORT;
      delete process.env.ESCROW_DEADLINE_SECONDS;
      const config = configuration();
      expect(config.port).toBe(3000);
      expect(config.stellar.escrowDeadlineSeconds).toBe(7776000);
      expect(config.analytics.platformSummaryTtlMs).toBe(60000);
    });

    it('fails fast on invalid ESCROW_DEADLINE_SECONDS typo', () => {
      process.env.ESCROW_DEADLINE_SECONDS = '90d';
      expect(() => configuration()).toThrow(
        'Invalid configuration for ESCROW_DEADLINE_SECONDS: expected a positive integer, got "90d"',
      );
    });

    it('fails fast on invalid PORT typo', () => {
      process.env.PORT = 'abc';
      expect(() => configuration()).toThrow(
        'Invalid configuration for PORT: expected a port number (1-65535), got "abc"',
      );
    });
  });
});
