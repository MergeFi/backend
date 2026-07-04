import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bounty, Issue, ReputationSnapshot } from '../common/entities';
import { ReputationService } from './reputation.service';
import { ReputationController } from './reputation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Bounty, Issue, ReputationSnapshot])],
  controllers: [ReputationController],
  providers: [ReputationService],
  exports: [ReputationService],
})
export class ReputationModule {}
