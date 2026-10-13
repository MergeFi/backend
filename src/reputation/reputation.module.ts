import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bounty, Payment, ReputationSnapshot } from '../common/entities';
import { ReputationService } from './reputation.service';
import { ReputationController } from './reputation.controller';
import { ReputationScheduler } from './reputation.scheduler';

@Module({
  imports: [TypeOrmModule.forFeature([Bounty, Payment, ReputationSnapshot])],
  controllers: [ReputationController],
  providers: [ReputationService, ReputationScheduler],
  exports: [ReputationService],
})
export class ReputationModule {}
