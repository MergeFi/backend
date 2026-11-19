import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compileFeatureModule } from '../../test/helpers/module-test.helpers';
import { GithubAccount, User } from '../common/entities';
import { UsersController } from './users.controller';
import { UsersModule } from './users.module';
import { UsersService } from './users.service';

describe('UsersModule (#837)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileFeatureModule(UsersModule);
  });

  afterAll(() => moduleRef.close());

  it.each([UsersService, UsersController])('resolves %p', (token) => {
    expect(moduleRef.get(token)).toBeInstanceOf(token);
  });

  it.each([User, GithubAccount])('registers the %p repository', (entity) => {
    expect(moduleRef.get(getRepositoryToken(entity))).toBeDefined();
  });
});
