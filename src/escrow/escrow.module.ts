import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Escrow, Payment } from '../common/entities';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';
import { SorobanClientService } from './soroban-client.service';
import { UsersModule } from '../users/users.module';

@Module({
  // UsersModule supplies the user-record lookup behind the
  // recipientId/recipientAddress cross-check (#40). It depends on nothing in
  // this module, so the edge stays one-way.
  imports: [TypeOrmModule.forFeature([Escrow, Payment]), UsersModule],
  controllers: [EscrowController],
  providers: [EscrowService, SorobanClientService],
  exports: [EscrowService, SorobanClientService],
})
export class EscrowModule {}
