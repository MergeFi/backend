import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bounty, Milestone, Payment } from '../common/entities';
import { SponsorsService } from './sponsors.service';
import { SponsorsController } from './sponsors.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Bounty, Milestone, Payment])],
  controllers: [SponsorsController],
  providers: [SponsorsService],
  exports: [SponsorsService],
})
export class SponsorsModule {}
