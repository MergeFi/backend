import { ApplicationConfig } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import {
  getOptionsToken,
  ThrottlerGuard,
  ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppModule } from './app.module';
import { AppService } from './app.service';
import { AnalyticsService } from './analytics/analytics.service';
import { AuthService } from './auth/auth.service';
import { BountiesService } from './bounties/bounties.service';
import { entities } from './common/entities/typeorm-entities';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { EscrowService } from './escrow/escrow.service';
import { GithubSyncService } from './github/github-sync.service';
import { MaintenancePoolService } from './maintenance-pool/maintenance-pool.service';
import { MilestonesService } from './milestones/milestones.service';
import { ReputationService } from './reputation/reputation.service';
import { SponsorsService } from './sponsors/sponsors.service';
import { TeamsService } from './teams/teams.service';
import { UsersService } from './users/users.service';

/**
 * Compiles the real AppModule. The TypeORM factory still runs and builds a
 * real DataSource from it (so its options can be asserted), but
 * `initialize()` is stubbed so no Postgres connection is opened.
 */
async function compileAppModule(): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [AppModule] }).compile();
}

describe('AppModule wiring (#837)', () => {
  const originalSynchronize = process.env.DATABASE_SYNCHRONIZE;
  const originalNodeEnv = process.env.NODE_ENV;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    jest.spyOn(DataSource.prototype, 'initialize').mockImplementation(function (
      this: DataSource,
    ) {
      return Promise.resolve(this);
    });
    delete process.env.DATABASE_SYNCHRONIZE;
    moduleRef = await compileAppModule();
  });

  afterAll(async () => {
    await moduleRef.close();
    if (originalSynchronize === undefined) {
      delete process.env.DATABASE_SYNCHRONIZE;
    } else {
      process.env.DATABASE_SYNCHRONIZE = originalSynchronize;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    jest.restoreAllMocks();
  });

  it.each([
    AppService,
    AppController,
    AuthService,
    UsersService,
    GithubSyncService,
    EscrowService,
    BountiesService,
    TeamsService,
    MilestonesService,
    SponsorsService,
    MaintenancePoolService,
    ReputationService,
    AnalyticsService,
    IdempotencyInterceptor,
  ])('resolves %p', (token) => {
    expect(moduleRef.get(token, { strict: false })).toBeInstanceOf(token);
  });

  describe('throttling (#287)', () => {
    it('registers the default, short, medium and long named throttlers', () => {
      const options = moduleRef.get<ThrottlerModuleOptions>(getOptionsToken(), {
        strict: false,
      });
      const throttlers = Array.isArray(options) ? options : options.throttlers;

      expect(throttlers.map((t) => t.name).sort()).toEqual(
        ['default', 'long', 'medium', 'short'].sort(),
      );
    });

    it('registers ThrottlerGuard as a global (APP_GUARD) guard', () => {
      const appConfig = (
        moduleRef as unknown as { applicationConfig: ApplicationConfig }
      ).applicationConfig;

      expect(
        appConfig
          .getGlobalGuards()
          .some((guard) => guard instanceof ThrottlerGuard),
      ).toBe(true);
    });
  });

  describe('TypeORM factory', () => {
    it('leaves synchronize off when DATABASE_SYNCHRONIZE is unset', () => {
      expect(moduleRef.get(DataSource).options.synchronize).toBe(false);
    });

    it('builds a postgres DataSource with the entity list registered', () => {
      const { options } = moduleRef.get(DataSource);
      expect(options.type).toBe('postgres');
      expect(options.entities).toEqual(entities);
    });

    it('turns synchronize on only in development when DATABASE_SYNCHRONIZE=true', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_SYNCHRONIZE = 'true';
      const syncRef = await compileAppModule();
      try {
        expect(syncRef.get(DataSource).options.synchronize).toBe(true);
      } finally {
        delete process.env.DATABASE_SYNCHRONIZE;
        if (originalNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = originalNodeEnv;
        }
        await syncRef.close();
      }
    });

    it('ignores DATABASE_SYNCHRONIZE outside development', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_SYNCHRONIZE = 'true';
      const syncRef = await compileAppModule();
      try {
        expect(syncRef.get(DataSource).options.synchronize).toBe(false);
      } finally {
        delete process.env.DATABASE_SYNCHRONIZE;
        if (originalNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = originalNodeEnv;
        }
        await syncRef.close();
      }
    });
  });

  describe('event emitter', () => {
    // BountiesService and GithubSyncService take @Optional() EventEmitter2:
    // without EventEmitterModule they silently skip analytics invalidation
    // instead of failing to boot.
    it.each([BountiesService, GithubSyncService])(
      'injects EventEmitter2 into %p',
      (token) => {
        const service = moduleRef.get(token, { strict: false });
        expect(service.eventEmitter).toBeInstanceOf(EventEmitter2);
      },
    );
  });
});
