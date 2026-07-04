import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Escrow, Payment } from '../common/entities';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';
import { SorobanClientService } from './soroban-client.service';

@Module({
  imports: [TypeOrmModule.forFeature([Escrow, Payment])],
  controllers: [EscrowController],
  providers: [EscrowService, SorobanClientService],
  exports: [EscrowService, SorobanClientService],
})
export class EscrowModule {}
