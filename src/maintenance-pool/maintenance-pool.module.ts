import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MaintenancePool } from '../common/entities';
import { MaintenancePoolService } from './maintenance-pool.service';
import { MaintenancePoolController } from './maintenance-pool.controller';
import { EscrowModule } from '../escrow/escrow.module';

@Module({
  imports: [TypeOrmModule.forFeature([MaintenancePool]), EscrowModule],
  controllers: [MaintenancePoolController],
  providers: [MaintenancePoolService],
  exports: [MaintenancePoolService],
})
export class MaintenancePoolModule {}
