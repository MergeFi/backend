import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Escrow } from '../common/entities/escrow.entity';
import { Payment } from '../common/entities/payment.entity';
import { EscrowStatus } from '../common/enums';
import { SorobanClientService } from './soroban-client.service';
import { SplitRecipient } from './dto/split-release.dto';

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    @InjectRepository(Escrow)
    private readonly escrowRepo: Repository<Escrow>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly soroban: SorobanClientService,
  ) {}

  async getOrThrow(id: string): Promise<Escrow> {
    const escrow = await this.escrowRepo.findOne({ where: { id } });
    if (!escrow) throw new NotFoundException(`Escrow ${id} not found`);
    return escrow;
  }

  assertLocked(escrow: Escrow) {
    if (escrow.status !== EscrowStatus.LOCKED) {
      throw new BadRequestException(`Escrow ${escrow.id} is not locked (status: ${escrow.status})`);
    }
  }

  assertValidSplits(recipients: SplitRecipient[]) {
    if (!recipients.length) throw new BadRequestException('At least one recipient required');
    const sum = recipients.reduce((acc, r) => acc + r.percentage, 0);
    if (Math.abs(sum - 100) > 0.01) {
      throw new BadRequestException(`Split percentages must sum to 100, got ${sum}`);
    }
    for (const r of recipients) {
      if (r.percentage <= 0 || r.percentage > 100) {
        throw new BadRequestException(`Invalid percentage ${r.percentage} for ${r.recipientAddress}`);
      }
    }
  }

  private roundAmount(value: number): number {
    return Math.round(value * 1e7) / 1e7;
  }

  private stroopsToAmount(stroops: bigint): string {
    return (Number(stroops) / 1e7).toFixed(7);
  }

  private amountToStroops(amount: string): bigint {
    return BigInt(Math.round(Number(amount) * 1e7));
  }

  async splitRelease(escrowId: string, recipients: SplitRecipient[]): Promise<Payment[]> {
    const escrow = await this.getOrThrow(escrowId);
    this.assertLocked(escrow);
    this.assertValidSplits(recipients);

    // Compute basis points (what gets sent on-chain) once
    const basisPoints = recipients.map((r) => Math.round(r.percentage * 100));

    const result = await this.soroban.invoke('split_release', [
      escrow.bountyId ?? escrow.milestoneId ?? escrow.id,
      recipients.map((r) => r.recipientAddress),
      basisPoints,
    ]);

    escrow.status = EscrowStatus.RELEASED;
    await this.escrowRepo.save(escrow);

    const totalStroops = this.amountToStroops(escrow.amount);
    
    // Compute each recipient's share in stroops using the same basis points sent on-chain
    // Use largest remainder method to allocate any rounding remainder
    const shares: bigint[] = [];
    let allocatedStroops = 0n;
    
    for (const bp of basisPoints) {
      // Each share = floor(totalStroops * bp / 10000)
      const share = (totalStroops * BigInt(bp)) / 10000n;
      shares.push(share);
      allocatedStroops += share;
    }

    // Distribute remainder to recipients with largest fractional remainders
    const remainder = totalStroops - allocatedStroops;
    if (remainder > 0n) {
      // Calculate remainders for each recipient
      const remainders = basisPoints.map((bp, i) => ({
        index: i,
        // Fractional part: (totalStroops * bp) % 10000
        remainder: (totalStroops * BigInt(bp)) % 10000n,
      }));
      // Sort by remainder descending, then by index ascending for tie-breaking
      remainders.sort((a, b) => {
        if (b.remainder !== a.remainder) return Number(b.remainder - a.remainder);
        return a.index - b.index;
      });
      // Give 1 stroop to each of the top 'remainder' recipients
      for (let i = 0; i < Number(remainder); i++) {
        shares[remainders[i].index] += 1n;
      }
    }

    // Verify sum matches exactly
    const sumShares = shares.reduce((acc, s) => acc + s, 0n);
    if (sumShares !== totalStroops) {
      this.logger.error(
        `Split allocation mismatch: sum=${sumShares} expected=${totalStroops} escrow=${escrowId}`,
      );
      throw new Error(`Internal error: split allocation failed to match escrow amount`);
    }

    // TODO: When the deployed contract returns actual per-recipient amounts in result.returnValue,
    // prefer those over locally computed shares and log any discrepancy as a reconciliation anomaly.
    // For now, result.returnValue is not structured for split_release (see soroban-client.service.ts TODO).

    const payments: Payment[] = [];
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const shareStroops = shares[i];
      const payment = this.paymentRepo.create({
        escrowId: escrow.id,
        recipientAddress: recipient.recipientAddress,
        amount: this.stroopsToAmount(shareStroops),
        splitPercentage: recipient.percentage.toFixed(2),
        txHash: result.txHash,
        status: 'confirmed',
      });
      payments.push(await this.paymentRepo.save(payment));
    }
    return payments;
  }

  async fundEscrow(escrowId: string, amount: string, txHash: string): Promise<Escrow> {
    const escrow = await this.getOrThrow(escrowId);
    if (escrow.status !== EscrowStatus.PENDING) {
      throw new BadRequestException(`Escrow ${escrow.id} is not pending (status: ${escrow.status})`);
    }
    escrow.amount = amount;
    escrow.status = EscrowStatus.LOCKED;
    escrow.fundTxHash = txHash;
    return this.escrowRepo.save(escrow);
  }

  async releaseEscrow(escrowId: string, txHash: string): Promise<Escrow> {
    const escrow = await this.getOrThrow(escrowId);
    this.assertLocked(escrow);

    await this.soroban.invoke('release', [escrow.bountyId ?? escrow.milestoneId ?? escrow.id]);

    escrow.status = EscrowStatus.RELEASED;
    escrow.releaseTxHash = txHash;
    return this.escrowRepo.save(escrow);
  }

  async refundEscrow(escrowId: string, txHash: string): Promise<Escrow> {
    const escrow = await this.getOrThrow(escrowId);
    if (escrow.status !== EscrowStatus.LOCKED) {
      throw new BadRequestException(`Escrow ${escrow.id} is not locked (status: ${escrow.status})`);
    }

    await this.soroban.invoke('refund', [escrow.bountyId ?? escrow.milestoneId ?? escrow.id]);

    escrow.status = EscrowStatus.REFUNDED;
    escrow.refundTxHash = txHash;
    return this.escrowRepo.save(escrow);
  }
}
