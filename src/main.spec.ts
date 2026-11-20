import { bootstrap } from './main';

const mockCreate = jest.fn();

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
});
