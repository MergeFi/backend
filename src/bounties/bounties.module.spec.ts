import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compileFeatureModule } from '../../test/helpers/module-test.helpers';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Bounty, Issue, Team, User } from '../common/entities';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { EscrowService } from '../escrow/escrow.service';
import { BountiesController } from './bounties.controller';
import { BountiesModule } from './bounties.module';
import { BountiesService } from './bounties.service';
import { BountyExpiryScheduler } from './bounty-expiry.scheduler';

describe('BountiesModule (#837)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileFeatureModule(BountiesModule);
  });

  afterAll(() => moduleRef.close());

  it.each([BountiesService, BountyExpiryScheduler, BountiesController])(
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

  it.each([Bounty, Issue, Team, User, IdempotencyKey])(
    'registers the %p repository',
    (entity) => {
      expect(moduleRef.get(getRepositoryToken(entity))).toBeDefined();
    },
  );

  // Money-moving routes are guarded by @UseGuards(RolesGuard) and
  // @Idempotent(); both are instantiated in this module's own scope, so a
  // missing repository here leaves the route unbootable rather than unguarded.
  it.each([RolesGuard, IdempotencyInterceptor])(
    'instantiates the %p enhancer in this module',
    (enhancer) => {
      expect(
        moduleRef.select(BountiesModule).get(enhancer, { strict: true }),
      ).toBeInstanceOf(enhancer);
    },
  );
});
