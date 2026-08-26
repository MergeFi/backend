import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bounty, Team, User } from '../common/entities';
import { BountiesService } from './bounties.service';
import { BountiesController } from './bounties.controller';
import { EscrowModule } from '../escrow/escrow.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Bounty, Team, User]),
    EscrowModule,
    AuthModule,
  ],
  controllers: [BountiesController],
  providers: [BountiesService],
  exports: [BountiesService],
})
export class BountiesModule {}
