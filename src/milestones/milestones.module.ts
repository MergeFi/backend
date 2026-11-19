import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Issue, Milestone, User } from '../common/entities';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { MilestonesService } from './milestones.service';
import { MilestonesController } from './milestones.controller';
import { EscrowModule } from '../escrow/escrow.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // See TeamsModule for why RolesGuard needs User here too. Same story for
    // @Idempotent()'s IdempotencyInterceptor and IdempotencyKey.
    TypeOrmModule.forFeature([Milestone, Issue, User, IdempotencyKey]),
    EscrowModule,
    AuthModule,
  ],
  controllers: [MilestonesController],
  providers: [MilestonesService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
