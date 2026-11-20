import { JwtService } from '@nestjs/jwt';
import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compileFeatureModule } from '../../test/helpers/module-test.helpers';
import { Repository, User } from '../common/entities';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { RepoScopeGuard } from './guards/repo-scope.guard';
import { RolesGuard } from './guards/roles.guard';
import { GithubStrategy } from './strategies/github.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

describe('AuthModule (#837)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileFeatureModule(AuthModule);
  });

  afterAll(() => moduleRef.close());

  it.each([
    AuthService,
    JwtStrategy,
    GithubStrategy,
    RolesGuard,
    RepoScopeGuard,
    AuthController,
  ])('resolves %p', (token) => {
    expect(moduleRef.get(token)).toBeInstanceOf(token);
  });

  it('receives UsersService from the imported UsersModule', () => {
    expect(moduleRef.get(UsersService, { strict: false })).toBeInstanceOf(
      UsersService,
    );
  });

  it.each([User, Repository])('registers the %p repository', (entity) => {
    expect(moduleRef.get(getRepositoryToken(entity))).toBeDefined();
  });

  it('configures JwtModule from the jwt config so issued tokens verify', () => {
    const jwt = moduleRef.get(JwtService, { strict: false });
    const token = jwt.sign({ sub: 'user-1' });

    expect(jwt.verify<{ sub: string; exp: number }>(token)).toEqual(
      expect.objectContaining({ sub: 'user-1', exp: expect.any(Number) }),
    );
  });
});
