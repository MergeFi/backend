import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/**
 * Global so `@Idempotent(scope)` (which references IdempotencyInterceptor
 * by class, not instance) resolves from any feature module's controllers
 * without each of them having to import this module individually — see
 * bounties/escrow/milestones/maintenance-pool controllers (#16).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyKey])],
  providers: [IdempotencyInterceptor, IdempotencyCleanupService],
  exports: [IdempotencyInterceptor],
})
export class IdempotencyModule {}
