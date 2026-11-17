import configuration from './configuration';
import {
  assertRequiredConfig,
  collectConfigIssues,
  DEFAULT_LOCAL_DATABASE_URL,
  INSECURE_DEFAULT_JWT_SECRET,
} from './validate-required-config';

type Config = Parameters<typeof collectConfigIssues>[0];

const validProduction = (): Config => ({
  ...configuration(),
  env: 'production',
  database: {
    url: 'postgresql://user:pw@db.internal:5432/mergefi',
    synchronize: false,
    logging: false,
  },
  jwt: { secret: 'a-long-random-secret', expiresIn: '7d' },
  github: {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    oauthCallbackUrl: 'https://api.example.com/api/auth/github/callback',
    apiToken: 'token',
    webhookSecret: 'webhook-secret',
    syncAllowedRepos: '',
  },
  stellar: {
    ...configuration().stellar,
    escrowContractId: 'CESCROW',
    treasurySecret: 'STREASURY',
  },
});

const keys = (config: Config) => collectConfigIssues(config).map((i) => i.key);

const REQUIRED_PRODUCTION_KEYS = [
  'JWT_SECRET',
  'DATABASE_URL',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'ESCROW_CONTRACT_ID',
  'TREASURY_SECRET',
];

const emptyConfig = (env = 'production'): Config => ({
  env,
  database: {
    url: '',
    synchronize: false,
    logging: false,
  },
  jwt: { secret: '', expiresIn: '' },
  github: {
    clientId: '',
    clientSecret: '',
    oauthCallbackUrl: '',
    apiToken: '',
    webhookSecret: '',
    syncAllowedRepos: '',
  },
  stellar: {
    network: '',
    sorobanRpcUrl: '',
    networkPassphrase: '',
    escrowContractId: '',
    maintenancePoolContractId: '',
    treasurySecret: '',
    assetContractIds: { USDC: '', XLM: '' },
    escrowDeadlineSeconds: 0,
  },
});

describe('collectConfigIssues', () => {
  it.each(['development', 'test', 'staging', 'local', 'ci', ''])(
    'returns no issues outside production (env: %p) even with no secrets set',
    (env) => {
      const config = emptyConfig(env);
      expect(collectConfigIssues(config)).toEqual([]);
      expect(() => assertRequiredConfig(config)).not.toThrow();
    },
  );

  it.each([
    ['empty secrets', emptyConfig('production')],
    [
      'development defaults',
      {
        ...emptyConfig('production'),
        database: {
          url: DEFAULT_LOCAL_DATABASE_URL,
          synchronize: false,
          logging: false,
        },
        jwt: {
          secret: INSECURE_DEFAULT_JWT_SECRET,
          expiresIn: '7d',
        },
      },
    ],
  ])(
    'reports the exact set of required keys for an empty production config with %s',
    (_, config) => {
      expect(keys(config)).toEqual(REQUIRED_PRODUCTION_KEYS);
    },
  );

  it('is a no-op outside production, even with every secret missing', () => {
    const config: Config = {
      ...configuration(),
      env: 'development',
      jwt: { secret: INSECURE_DEFAULT_JWT_SECRET, expiresIn: '7d' },
    };
    expect(collectConfigIssues(config)).toEqual([]);
    expect(() => assertRequiredConfig(config)).not.toThrow();
  });

  it('reports nothing for a fully configured production environment', () => {
    expect(collectConfigIssues(validProduction())).toEqual([]);
  });

  it.each([
    ['GITHUB_WEBHOOK_SECRET', (c: Config) => (c.github.webhookSecret = '')],
    ['GITHUB_CLIENT_ID', (c: Config) => (c.github.clientId = '')],
    ['GITHUB_CLIENT_SECRET', (c: Config) => (c.github.clientSecret = '  ')],
    ['ESCROW_CONTRACT_ID', (c: Config) => (c.stellar.escrowContractId = '')],
    ['TREASURY_SECRET', (c: Config) => (c.stellar.treasurySecret = '')],
    ['JWT_SECRET', (c: Config) => (c.jwt.secret = '')],
  ])('flags a missing %s', (key, mutate) => {
    const config = validProduction();
    mutate(config);
    expect(keys(config)).toEqual([key]);
  });

  it('flags the insecure default JWT secret', () => {
    const config = validProduction();
    config.jwt.secret = INSECURE_DEFAULT_JWT_SECRET;
    const issues = collectConfigIssues(config);
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe('JWT_SECRET');
    expect(issues[0].message).toContain('insecure dev default');
  });

  it('flags the default and an empty DATABASE_URL', () => {
    const config = validProduction();
    config.database.url = DEFAULT_LOCAL_DATABASE_URL;
    expect(keys(config)).toEqual(['DATABASE_URL']);
    config.database.url = '';
    expect(keys(config)).toEqual(['DATABASE_URL']);
  });

  it('collects every problem at once', () => {
    const config = validProduction();
    config.jwt.secret = INSECURE_DEFAULT_JWT_SECRET;
    config.database.url = DEFAULT_LOCAL_DATABASE_URL;
    config.github.webhookSecret = '';
    expect(keys(config)).toEqual([
      'JWT_SECRET',
      'DATABASE_URL',
      'GITHUB_WEBHOOK_SECRET',
    ]);
  });
});

describe('assertRequiredConfig', () => {
  it('throws listing every issue in production', () => {
    const config = validProduction();
    config.jwt.secret = INSECURE_DEFAULT_JWT_SECRET;
    config.stellar.treasurySecret = '';
    expect(() => assertRequiredConfig(config)).toThrow(
      /Refusing to start in production[\s\S]*JWT_SECRET[\s\S]*TREASURY_SECRET/,
    );
  });

  it('throws listing all required issues in one throw for an empty production config', () => {
    const config = emptyConfig('production');
    expect(() => assertRequiredConfig(config)).toThrow(
      new RegExp(REQUIRED_PRODUCTION_KEYS.join('[\\s\\S]*')),
    );
  });

  it('does not throw for a valid production config', () => {
    expect(() => assertRequiredConfig(validProduction())).not.toThrow();
  });
});
