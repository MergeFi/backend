import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compileFeatureModule } from '../../test/helpers/module-test.helpers';
import { AuthService } from '../auth/auth.service';
import { Bounty, Payment, Repository } from '../common/entities';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsModule } from './analytics.module';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsModule (#837)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileFeatureModule(AnalyticsModule);
  });

  afterAll(() => moduleRef.close());

  it.each([AnalyticsService, AnalyticsController])('resolves %p', (token) => {
    expect(moduleRef.get(token)).toBeInstanceOf(token);
  });

  it('imports AuthModule', () => {
    expect(moduleRef.get(AuthService, { strict: false })).toBeInstanceOf(
      AuthService,
    );
  });

  it.each([Bounty, Payment, Repository])(
    'registers the %p repository',
    (entity) => {
      expect(moduleRef.get(getRepositoryToken(entity))).toBeDefined();
    },
  );
});
