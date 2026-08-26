import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Issue, Milestone } from '../common/entities';
import { MilestonesService } from './milestones.service';
import { MilestonesController } from './milestones.controller';
import { EscrowModule } from '../escrow/escrow.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Milestone, Issue]),
    EscrowModule,
    AuthModule,
  ],
  controllers: [MilestonesController],
  providers: [MilestonesService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
