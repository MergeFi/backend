import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
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
import { IdempotencyModule } from './common/idempotency/idempotency.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    EventEmitterModule.forRoot(),
    // Named throttlers: @Throttle({ short | medium | long: ... }) only takes
    // effect when a throttler of that name is registered here — with a single
    // unnamed entry those overrides were silently no-ops (#287). The limits
    // below are lenient app-wide defaults; per-route @Throttle tightens them.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
      { name: 'short', ttl: 1_000, limit: 20 },
      { name: 'medium', ttl: 60_000, limit: 120 },
      { name: 'long', ttl: 3_600_000, limit: 5_000 },
    ]),
    ScheduleModule.forRoot(),
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
    IdempotencyModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // This executes your rate-limiting security guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
