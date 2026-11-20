import { bootstrap } from './main';

const mockCreate = jest.fn();
const mockExpressSet = jest.fn();
const mockApp = {
  get: jest.fn(),
  getHttpAdapter: jest.fn().mockReturnValue({
    getInstance: () => ({ set: mockExpressSet }),
  }),
  useLogger: jest.fn(),
  use: jest.fn(),
  enableCors: jest.fn(),
  setGlobalPrefix: jest.fn(),
  useGlobalPipes: jest.fn(),
  useGlobalFilters: jest.fn(),
  listen: jest.fn(),
};

// AppModule pulls in TypeORM, Octokit and the schedulers; bootstrap must never
// get as far as building it when the config is invalid (#551).
jest.mock('./app.module', () => ({ AppModule: class AppModule {} }));
jest.mock('@nestjs/core', () => ({
  ...jest.requireActual<object>('@nestjs/core'),
  NestFactory: { create: (...args: unknown[]) => mockCreate(...args) },
}));

describe('bootstrap config validation (#551)', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    jest.clearAllMocks();
  });

  it('refuses insecure production config before creating the app (no DB connection attempted)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.DATABASE_URL;

    await expect(bootstrap()).rejects.toThrow(
      /Refusing to start in production with an incomplete configuration[\s\S]*JWT_SECRET/,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('configures Express trust proxy from application config', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '4000';
    process.env.JWT_SECRET = 'a-real-production-secret';
    process.env.DATABASE_URL = 'postgres://db.example.com/mergefi';
    process.env.GITHUB_CLIENT_ID = 'github-client';
    process.env.GITHUB_CLIENT_SECRET = 'github-secret';
    process.env.GITHUB_WEBHOOK_SECRET = 'webhook-secret';
    process.env.ESCROW_CONTRACT_ID = 'escrow-contract';
    process.env.MAINTENANCE_POOL_CONTRACT_ID = 'pool-contract';
    process.env.TREASURY_SECRET = 'treasury-secret';
    delete process.env.SWAGGER_BASIC_AUTH;

    const configValues: Record<string, string | number | string[]> = {
      env: 'production',
      logLevel: 'error',
      frontendUrl: 'http://localhost:3000',
      port: 4000,
      trustProxy: 1,
    };
    const configService = { get: (key: string) => configValues[key] };
    mockApp.get.mockReturnValue(configService);
    mockApp.listen.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue(mockApp);

    await bootstrap();

    expect(mockExpressSet).toHaveBeenCalledWith('trust proxy', 1);
  });
});
