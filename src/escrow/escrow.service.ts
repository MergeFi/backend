import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Escrow } from '../common/entities/escrow.entity';
import { Payment } from '../common/entities/payment.entity';
import { EscrowStatus } from '../common/enums';
import { FundEscrowDto } from './dto/fund-escrow.dto';
import { ReleaseEscrowDto } from './dto/release-escrow.dto';
import { SplitReleaseDto } from './dto/split-release.dto';
import { SorobanClientService } from './soroban-client.service';

@Injectable()
export class EscrowService {
  constructor(
    @InjectRepository(Escrow)
    private readonly escrowRepo: Repository<Escrow>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly soroban: SorobanClientService,
  ) {}

  async fund(dto: FundEscrowDto): Promise<Escrow> {
    const escrow = this.escrowRepo.create({
      asset: dto.asset,
      amount: dto.amount,
      funderAddress: dto.funderAddress,
      maintenancePoolId: dto.maintenancePoolId,
      status: EscrowStatus.LOCKED,
    });
    const saved = await this.escrowRepo.save(escrow);

    if (this.soroban.isConfigured()) {
      try {
        const result = await this.soroban.fundEscrow(saved.id, dto.asset, dto.amount, dto.funderAddress);
        saved.contractId = result.contractId;
        saved.transactionHash = result.txHash;
        await this.escrowRepo.save(saved);
      } catch (e) {
        saved.status = EscrowStatus.FAILED;
        await this.escrowRepo.save(saved);
        throw e;
      }
    }

    return saved;
  }

  async findOne(id: string): Promise<Escrow> {
    const escrow = await this.escrowRepo.findOne({ where: { id } });
    if (!escrow) throw new NotFoundException(`Escrow ${id} not found`);
    return escrow;
  }

  async findByMaintenancePool(poolId: string): Promise<Escrow[]> {
    return this.escrowRepo.find({
      where: { maintenancePoolId: poolId },
      order: { createdAt: 'ASC' },
    });
  }

  async findLockedByMaintenancePool(poolId: string): Promise<Escrow[]> {
    return this.escrowRepo.find({
      where: { maintenancePoolId: poolId, status: EscrowStatus.LOCKED },
      order: { createdAt: 'ASC' },
    });
  }

  async releasePartial(
    escrowId: string,
    amount: string,
    recipientAddress: string,
    recipientId?: string,
  ): Promise<Payment> {
    const escrow = await this.findOne(escrowId);
    if (escrow.status !== EscrowStatus.LOCKED) {
      throw new BadRequestException(`Escrow ${escrowId} is not LOCKED (status: ${escrow.status})`);
    }
    const available = Number(escrow.amount) - Number(escrow.releasedAmount);
    if (Number(amount) > available) {
      throw new BadRequestException(`Requested ${amount} exceeds available ${available.toFixed(7)} in escrow ${escrowId}`);
    }

    let txHash: string | undefined;
    if (this.soroban.isConfigured()) {
      txHash = await this.soroban.releaseEscrow(escrowId, amount, recipientAddress);
    }

    escrow.releasedAmount = (Number(escrow.releasedAmount) + Number(amount)).toFixed(7);
    if (Number(escrow.releasedAmount) >= Number(escrow.amount)) {
      escrow.status = EscrowStatus.RELEASED;
    }
    if (txHash) escrow.transactionHash = txHash;
    await this.escrowRepo.save(escrow);

    const payment = this.paymentRepo.create({
      escrowId: escrow.id,
      amount,
      recipientAddress,
      recipientId,
      transactionHash: txHash,
    });
    return this.paymentRepo.save(payment);
  }

  async releasePartialFromPool(
    poolId: string,
    amount: string,
    recipientAddress: string,
    recipientId?: string,
  ): Promise<Payment[]> {
    const escrows = await this.findLockedByMaintenancePool(poolId);
    if (escrows.length === 0) {
      throw new BadRequestException(`No locked escrows found for pool ${poolId}`);
    }

    let remaining = Number(amount);
    const payments: Payment[] = [];

    for (const escrow of escrows) {
      if (remaining <= 0) break;

      const available = Number(escrow.amount) - Number(escrow.releasedAmount);
      if (available <= 0) continue;

      const toRelease = Math.min(remaining, available);
      const payment = await this.releasePartial(escrow.id, toRelease.toFixed(7), recipientAddress, recipientId);
      payments.push(payment);
      remaining -= toRelease;
    }

    if (remaining > 0) {
      throw new BadRequestException(`Insufficient funds across all escrows for pool ${poolId}; short by ${remaining.toFixed(7)}`);
    }

    return payments;
  }

  async releaseFull(escrowId: string, recipientAddress: string, recipientId?: string): Promise<Payment> {
    const escrow = await this.findOne(escrowId);
    return this.releasePartial(escrowId, escrow.availableAmount, recipientAddress, recipientId);
  }

  async splitRelease(dto: SplitReleaseDto): Promise<Payment[]> {
    const escrow = await this.findOne(dto.escrowId);
    if (escrow.status !== EscrowStatus.LOCKED) {
      throw new BadRequestException(`Escrow ${dto.escrowId} is not LOCKED`);
    }
    const totalRequested = dto.splits.reduce((sum, s) => sum + Number(s.amount), 0);
    const available = Number(escrow.amount) - Number(escrow.releasedAmount);
    if (totalRequested > available) {
      throw new BadRequestException(`Split total ${totalRequested} exceeds available ${available}`);
    }

    const payments: Payment[] = [];
    for (const split of dto.splits) {
      const payment = await this.releasePartial(escrow.id, split.amount, split.recipientAddress, split.recipientId);
      payments.push(payment);
    }
    return payments;
  }

  async refund(escrowId: string): Promise<Escrow> {
    const escrow = await this.findOne(escrowId);
    if (escrow.status !== EscrowStatus.LOCKED) {
      throw new BadRequestException(`Escrow ${escrowId} is not LOCKED (status: ${escrow.status})`);
    }
    if (Number(escrow.releasedAmount) > 0) {
      throw new BadRequestException(`Escrow ${escrowId} has already been partially released; cannot refund`);
    }

    if (this.soroban.isConfigured()) {
      await this.soroban.refundEscrow(escrowId);
    }

    escrow.status = EscrowStatus.REFUNDED;
    return this.escrowRepo.save(escrow);
  }
}
