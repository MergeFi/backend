import { GLOBAL_MODULE_METADATA } from '@nestjs/common/constants';
import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compileFeatureModule } from '../../../test/helpers/module-test.helpers';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyModule } from './idempotency.module';

describe('IdempotencyModule (#837)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileFeatureModule(IdempotencyModule);
  });

  afterAll(() => moduleRef.close());

  it.each([IdempotencyInterceptor, IdempotencyCleanupService])(
    'resolves %p',
    (token) => {
      expect(moduleRef.get(token)).toBeInstanceOf(token);
    },
  );

  it('registers the IdempotencyKey repository', () => {
    expect(moduleRef.get(getRepositoryToken(IdempotencyKey))).toBeDefined();
  });

  // @Idempotent() references IdempotencyInterceptor by class, so it must be
  // reachable from every feature module's controllers (#16).
  it('is @Global() and exports IdempotencyInterceptor', () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, IdempotencyModule)).toBe(
      true,
    );
    expect(Reflect.getMetadata('exports', IdempotencyModule)).toContain(
      IdempotencyInterceptor,
    );
  });
});
