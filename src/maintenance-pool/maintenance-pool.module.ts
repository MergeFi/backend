import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Issue, MaintenancePool } from '../common/entities';
import { MaintenancePoolService } from './maintenance-pool.service';
import { MaintenancePoolController } from './maintenance-pool.controller';
import { EscrowModule } from '../escrow/escrow.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MaintenancePool, Issue]),
    EscrowModule,
    AuthModule,
  ],
  controllers: [MaintenancePoolController],
  providers: [MaintenancePoolService],
  exports: [MaintenancePoolService],
})
export class MaintenancePoolModule {}
