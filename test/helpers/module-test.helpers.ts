import { Global, Module, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import configuration from '../../src/config/configuration';

/**
 * Minimal stand-in for a TypeORM DataSource: enough for
 * `TypeOrmModule.forFeature`'s repository factories and for services that
 * inject the DataSource directly, without opening a Postgres connection.
 */
export function createMockDataSource(): DataSource {
  return {
    options: { type: 'postgres' },
    entityMetadatas: [],
    isInitialized: true,
    getRepository: jest.fn((target: unknown) => ({ target })),
    getTreeRepository: jest.fn((target: unknown) => ({ target })),
    transaction: jest.fn(),
    createQueryRunner: jest.fn(),
    query: jest.fn(),
  } as unknown as DataSource;
}

/**
 * What `TypeOrmModule.forRoot*` provides globally in the real app — the
 * default DataSource token every `forFeature` repository factory injects.
 */
@Global()
@Module({
  providers: [{ provide: DataSource, useFactory: createMockDataSource }],
  exports: [DataSource],
})
class MockDataSourceModule {}

/**
 * Compiles a single feature module the way AppModule hosts it: with the
 * global ConfigModule and a (mocked) default DataSource, and nothing else.
 * A provider whose dependency the module forgot to import fails here.
 */
export function compileFeatureModule(
  featureModule: Type<unknown>,
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [configuration],
      }),
      MockDataSourceModule,
      featureModule,
    ],
  }).compile();
}
