import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compileFeatureModule } from '../../test/helpers/module-test.helpers';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Escrow, Payment, User } from '../common/entities';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { EscrowController } from './escrow.controller';
import { EscrowModule } from './escrow.module';
import { EscrowService } from './escrow.service';
import { SorobanClientService } from './soroban-client.service';
import { EscrowReconciliationService } from './escrow-reconciliation.service';
import { EscrowReconciliationScheduler } from './escrow-reconciliation.scheduler';

describe('EscrowModule (#837)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileFeatureModule(EscrowModule);
  });

  afterAll(() => moduleRef.close());

  it.each([
    EscrowService,
    SorobanClientService,
    EscrowController,
    EscrowReconciliationService,
    EscrowReconciliationScheduler,
  ])('resolves %p', (token) => {
    expect(moduleRef.get(token)).toBeInstanceOf(token);
  });

  it.each([Escrow, Payment, User, IdempotencyKey])(
    'registers the %p repository',
    (entity) => {
      expect(moduleRef.get(getRepositoryToken(entity))).toBeDefined();
    },
  );

  // See BountiesModule spec: fund/release/refund are guarded and idempotent.
  it.each([RolesGuard, IdempotencyInterceptor])(
    'instantiates the %p enhancer in this module',
    (enhancer) => {
      expect(
        moduleRef.select(EscrowModule).get(enhancer, { strict: true }),
      ).toBeInstanceOf(enhancer);
    },
  );
});
