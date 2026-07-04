import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration, { AppConfig } from './config/configuration';
import { entities } from './common/entities/typeorm-entities';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { GithubModule } from './github/github.module';
import { BountiesModule } from './bounties/bounties.module';
import { EscrowModule } from './escrow/escrow.module';
import { TeamsModule } from './teams/teams.module';
import { MilestonesModule } from './milestones/milestones.module';
import { SponsorsModule } from './sponsors/sponsors.module';
import { MaintenancePoolModule } from './maintenance-pool/maintenance-pool.module';
import { ReputationModule } from './reputation/reputation.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const database = configService.get('database', { infer: true });
        return {
          type: 'postgres' as const,
          url: database.url,
          entities,
          synchronize: database.synchronize,
          logging: database.logging,
        };
      },
    }),
    AuthModule,
    UsersModule,
    GithubModule,
    EscrowModule,
    BountiesModule,
    TeamsModule,
    MilestonesModule,
    SponsorsModule,
    MaintenancePoolModule,
    ReputationModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
