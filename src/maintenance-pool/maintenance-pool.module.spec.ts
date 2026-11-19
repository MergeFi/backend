import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compileFeatureModule } from '../../test/helpers/module-test.helpers';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Issue, MaintenancePool, Payment, User } from '../common/entities';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { EscrowService } from '../escrow/escrow.service';
import { MaintenancePoolController } from './maintenance-pool.controller';
import { MaintenancePoolModule } from './maintenance-pool.module';
import { MaintenancePoolService } from './maintenance-pool.service';

describe('MaintenancePoolModule (#837)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileFeatureModule(MaintenancePoolModule);
  });

  afterAll(() => moduleRef.close());

  it.each([MaintenancePoolService, MaintenancePoolController])(
    'resolves %p',
    (token) => {
      expect(moduleRef.get(token)).toBeInstanceOf(token);
    },
  );

  it('receives EscrowService from the imported EscrowModule', () => {
    expect(moduleRef.get(EscrowService, { strict: false })).toBeInstanceOf(
      EscrowService,
    );
  });

  it.each([MaintenancePool, Issue, Payment, User, IdempotencyKey])(
    'registers the %p repository',
    (entity) => {
      expect(moduleRef.get(getRepositoryToken(entity))).toBeDefined();
    },
  );

  it.each([RolesGuard, IdempotencyInterceptor])(
    'instantiates the %p enhancer in this module',
    (enhancer) => {
      expect(
        moduleRef.select(MaintenancePoolModule).get(enhancer, { strict: true }),
      ).toBeInstanceOf(enhancer);
    },
  );
});
