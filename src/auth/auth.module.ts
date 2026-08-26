import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { User } from '../common/entities';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GithubStrategy } from './strategies/github.strategy';
import { AppConfig } from '../config/configuration';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([User]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const jwt = configService.get('jwt', { infer: true });
        return {
          secret: jwt.secret,
          signOptions: { expiresIn: jwt.expiresIn as string | number },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GithubStrategy, RolesGuard],
  exports: [AuthService, RolesGuard],
})
export class AuthModule {}
