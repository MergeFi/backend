import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compileFeatureModule } from '../../test/helpers/module-test.helpers';
import { Bounty, Escrow, Milestone, Payment } from '../common/entities';
import { SponsorsController } from './sponsors.controller';
import { SponsorsModule } from './sponsors.module';
import { SponsorsService } from './sponsors.service';

describe('SponsorsModule (#837)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileFeatureModule(SponsorsModule);
  });

  afterAll(() => moduleRef.close());

  it.each([SponsorsService, SponsorsController])('resolves %p', (token) => {
    expect(moduleRef.get(token)).toBeInstanceOf(token);
  });

  it.each([Bounty, Milestone, Payment, Escrow])(
    'registers the %p repository',
    (entity) => {
      expect(moduleRef.get(getRepositoryToken(entity))).toBeDefined();
    },
  );
});
