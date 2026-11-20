import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compileFeatureModule } from '../../test/helpers/module-test.helpers';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Bounty, Team, TeamMemberSplit, User } from '../common/entities';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { TeamsController } from './teams.controller';
import { TeamsModule } from './teams.module';
import { TeamsService } from './teams.service';

describe('TeamsModule (#837)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileFeatureModule(TeamsModule);
  });

  afterAll(() => moduleRef.close());

  it.each([TeamsService, TeamsController])('resolves %p', (token) => {
    expect(moduleRef.get(token)).toBeInstanceOf(token);
  });

  it.each([Team, TeamMemberSplit, Bounty, User, IdempotencyKey])(
    'registers the %p repository',
    (entity) => {
      expect(moduleRef.get(getRepositoryToken(entity))).toBeDefined();
    },
  );

  it.each([RolesGuard, IdempotencyInterceptor])(
    'instantiates the %p enhancer in this module',
    (enhancer) => {
      expect(
        moduleRef.select(TeamsModule).get(enhancer, { strict: true }),
      ).toBeInstanceOf(enhancer);
    },
  );
});
