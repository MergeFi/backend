import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bounty, Escrow, Milestone, Payment } from '../common/entities';
import { SponsorsService } from './sponsors.service';
import { SponsorsController } from './sponsors.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Bounty, Milestone, Payment, Escrow])],
  controllers: [SponsorsController],
  providers: [SponsorsService],
  exports: [SponsorsService],
})
export class SponsorsModule {}
