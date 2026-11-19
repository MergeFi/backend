import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compileFeatureModule } from '../../test/helpers/module-test.helpers';
import { Bounty, Payment, ReputationSnapshot } from '../common/entities';
import { ReputationController } from './reputation.controller';
import { ReputationModule } from './reputation.module';
import { ReputationService } from './reputation.service';

describe('ReputationModule (#837)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileFeatureModule(ReputationModule);
  });

  afterAll(() => moduleRef.close());

  it.each([ReputationService, ReputationController])('resolves %p', (token) => {
    expect(moduleRef.get(token)).toBeInstanceOf(token);
  });

  it.each([Bounty, Payment, ReputationSnapshot])(
    'registers the %p repository',
    (entity) => {
      expect(moduleRef.get(getRepositoryToken(entity))).toBeDefined();
    },
  );
});
