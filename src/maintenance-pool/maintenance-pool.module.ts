import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Issue, MaintenancePool, Payment, User } from '../common/entities';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { MaintenancePoolService } from './maintenance-pool.service';
import { MaintenancePoolController } from './maintenance-pool.controller';
import { EscrowModule } from '../escrow/escrow.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // See TeamsModule/BountiesModule for why RolesGuard and @Idempotent()
    // need User/IdempotencyKey resolvable here too.
    TypeOrmModule.forFeature([
      MaintenancePool,
      Issue,
      Payment,
      User,
      IdempotencyKey,
    ]),
    EscrowModule,
    AuthModule,
  ],
  controllers: [MaintenancePoolController],
  providers: [MaintenancePoolService],
  exports: [MaintenancePoolService],
})
export class MaintenancePoolModule {}
