import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bounty, Team, User } from '../common/entities';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { BountiesService } from './bounties.service';
import { BountiesController } from './bounties.controller';
import { BountyExpiryScheduler } from './bounty-expiry.scheduler';
import { EscrowModule } from '../escrow/escrow.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // RolesGuard and @Idempotent()'s IdempotencyInterceptor are used via
    // @UseGuards/@UseInterceptors class references on BountiesController —
    // see TeamsModule for why each needs its repository resolvable here
    // directly rather than only through an imported/global module.
    TypeOrmModule.forFeature([Bounty, Team, User, IdempotencyKey]),
    EscrowModule,
    AuthModule,
  ],
  controllers: [BountiesController],
  providers: [BountiesService, BountyExpiryScheduler],
  exports: [BountiesService],
})
export class BountiesModule {}
