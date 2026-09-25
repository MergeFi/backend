import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Escrow, Payment, User } from '../common/entities';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';
import { SorobanClientService } from './soroban-client.service';

@Module({
  imports: [
    // See TeamsModule/BountiesModule for why RolesGuard and @Idempotent()
    // need User/IdempotencyKey resolvable here directly.
    TypeOrmModule.forFeature([Escrow, Payment, User, IdempotencyKey]),
  ],
  controllers: [EscrowController],
  providers: [EscrowService, SorobanClientService],
  exports: [EscrowService, SorobanClientService],
})
export class EscrowModule {}
