import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// @ts-ignore
import type { StringValue } from 'ms';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GithubStrategy } from './strategies/github.strategy';
import { AppConfig } from '../config/configuration';
import { RolesGuard } from './guards/roles.guard';
import { RepoScopeGuard } from './guards/repo-scope.guard';
import { User } from '../common/entities/user.entity';
import { Repository } from '../common/entities';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule,
    // Repository is needed by RepoScopeGuard to read each repository's
    // maintainerId (#312).
    TypeOrmModule.forFeature([User, Repository]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const jwt = configService.get('jwt', { infer: true });
        return {
          secret: jwt.secret,
          signOptions: {
            // jwt.expiresIn is a free-form configured string (env var,
            // default '7d') — JwtModuleOptions wants jsonwebtoken's
            // ms.StringValue template-literal type, which can't be derived
            // from a plain `string` at the type level without a runtime
            // format check. The configured value is a duration string by
            // contract (see config/configuration.ts), so this is a narrow,
            // deliberate assertion rather than a blanket `any`.
            expiresIn: jwt.expiresIn as StringValue,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GithubStrategy, RolesGuard, RepoScopeGuard],
  exports: [AuthService, RolesGuard, RepoScopeGuard],
})
export class AuthModule {}
