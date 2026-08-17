import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MaintenancePool } from '../common/entities';
import { MaintenancePoolService } from './maintenance-pool.service';
import { MaintenancePoolController } from './maintenance-pool.controller';
import { EscrowModule } from '../escrow/escrow.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MaintenancePool]),
    EscrowModule,
    UsersModule,
  ],
  controllers: [MaintenancePoolController],
  providers: [MaintenancePoolService],
  exports: [MaintenancePoolService],
})
export class MaintenancePoolModule {}
