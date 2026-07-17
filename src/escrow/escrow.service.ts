import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Escrow, Payment } from '../common/entities';
import { AssetType, EscrowStatus, PaymentStatus } from '../common/enums';
import {
  amountToStroops,
  isSupportedEscrowAsset,
  isValidMoneyAmount,
} from '../common/validators/money.validator';
import { SorobanClientService } from './soroban-client.service';

export interface FundEscrowInput {
  amount: string;
  asset: AssetType;
  funderAddress: string;
  bountyId?: string;
  milestoneId?: string;
  maintenancePoolId?: string;
  /**
   * Denormalized sponsor identity, stored directly on the Escrow row rather
   * than only reachable via a join to bounty/milestone. This is what lets
   * sponsor-dashboard aggregates stay correct even after the parent
   * bounty/milestone is deleted (#27) — omit for maintenance-pool escrows,
   * which aren't sponsor-attributed.
   */
  sponsorId?: string | null;
}

export interface SplitRecipient {
  recipientAddress: string;
  recipientId?: string;
  percentage: number;
}

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    @InjectRepository(Escrow) private readonly escrowRepo: Repository<Escrow>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly soroban: SorobanClientService,
  ) {}

  /** Locks funds for a bounty/milestone/pool by calling the escrow contract's `fund`. */
  async fund(input: FundEscrowInput): Promise<Escrow> {
    this.assertValidFundInput(input);

    const escrow = this.escrowRepo.create({
      amount: input.amount,
      asset: input.asset,
      status: EscrowStatus.PENDING,
      fundedByAddress: input.funderAddress,
      bountyId: input.bountyId ?? null,
      milestoneId: input.milestoneId ?? null,
      maintenancePoolId: input.maintenancePoolId ?? null,
      sponsorId: input.sponsorId ?? null,
    });
    await this.escrowRepo.save(escrow);

    try {
      const referenceId =
        input.bountyId ??
        input.milestoneId ??
        input.maintenancePoolId ??
        escrow.id;
      const result = await this.soroban.invoke('fund', [
        input.funderAddress,
        referenceId,
        this.toStroops(input.amount),
      ]);

      escrow.status = EscrowStatus.LOCKED;
      escrow.fundTxHash = result.txHash;
      escrow.lockedAt = new Date();
      escrow.metadata = { fund: result };
      return this.escrowRepo.save(escrow);
    } catch (err) {
      escrow.status = EscrowStatus.FAILED;
      escrow.metadata = { error: (err as Error).message };
      await this.escrowRepo.save(escrow);
      throw err;
    }
  }

  /** Releases the full escrowed amount to a single recipient (standard bounty payout). */
  async release(
    escrowId: string,
    recipientAddress: string,
    recipientId?: string,
  ): Promise<Escrow> {
    const escrow = await this.getOrThrow(escrowId);
    this.assertLocked(escrow);

    const result = await this.soroban.invoke('release', [
      escrow.bountyId ??
        escrow.milestoneId ??
        escrow.maintenancePoolId ??
        escrow.id,
      recipientAddress,
    ]);

    escrow.status = EscrowStatus.RELEASED;
    escrow.releaseTxHash = result.txHash;
    escrow.releasedAt = new Date();
    await this.escrowRepo.save(escrow);

    const payment = this.paymentRepo.create({
      escrowId: escrow.id,
      recipientId: recipientId ?? null,
      recipientAddress,
      amount: escrow.amount,
      asset: escrow.asset,
      status: PaymentStatus.CONFIRMED,
      txHash: result.txHash,
    });
    await this.paymentRepo.save(payment);

    return escrow;
  }

  /**
   * Splits the escrowed amount across multiple recipients by percentage
   * (team bounties). Percentages must sum to exactly 100.
   */
  async splitRelease(
    escrowId: string,
    recipients: SplitRecipient[],
  ): Promise<Payment[]> {
    const escrow = await this.getOrThrow(escrowId);
    this.assertLocked(escrow);
    this.assertValidSplits(recipients);

    const result = await this.soroban.invoke('split_release', [
      escrow.bountyId ?? escrow.milestoneId ?? escrow.id,
      recipients.map((r) => r.recipientAddress),
      recipients.map((r) => Math.round(r.percentage * 100)), // basis points-ish, 2dp -> integer
    ]);

    escrow.status = EscrowStatus.RELEASED;
    escrow.releaseTxHash = result.txHash;
    escrow.releasedAt = new Date();
    await this.escrowRepo.save(escrow);

    const totalAmount = Number(escrow.amount);
    const payments: Payment[] = [];
    for (const recipient of recipients) {
      const share = this.roundAmount(
        (totalAmount * recipient.percentage) / 100,
      );
      const payment = this.paymentRepo.create({
        escrowId: escrow.id,
        recipientId: recipient.recipientId ?? null,
        recipientAddress: recipient.recipientAddress,
        amount: share.toFixed(7),
        asset: escrow.asset,
        splitPercentage: recipient.percentage.toFixed(2),
        status: PaymentStatus.CONFIRMED,
        txHash: result.txHash,
      });
      payments.push(await this.paymentRepo.save(payment));
    }
    return payments;
  }

  /**
   * Releases a portion of a LOCKED escrow to a single recipient without
   * closing it out — used by milestone funding, where the total budget is
   * distributed incrementally as individual issues resolve. The escrow
   * moves to RELEASED once the cumulative released amount reaches the
   * total locked amount.
   */
  async releasePartial(
    escrowId: string,
    amount: string,
    recipientAddress: string,
    recipientId?: string,
  ): Promise<Payment> {
    const escrow = await this.getOrThrow(escrowId);
    this.assertLocked(escrow);
    this.assertValidAmount(amount);

    const existingPayments = await this.paymentRepo.find({
      where: { escrowId: escrow.id },
    });
    const releasedSoFar = existingPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );
    const requested = Number(amount);
    if (releasedSoFar + requested > Number(escrow.amount) + 1e-7) {
      throw new BadRequestException(
        `Partial release of ${amount} would exceed remaining escrow balance`,
      );
    }

    const result = await this.soroban.invoke('release', [
      escrow.milestoneId ?? escrow.bountyId ?? escrow.id,
      recipientAddress,
      this.toStroops(amount),
    ]);

    const payment = await this.paymentRepo.save(
      this.paymentRepo.create({
        escrowId: escrow.id,
        recipientId: recipientId ?? null,
        recipientAddress,
        amount,
        asset: escrow.asset,
        status: PaymentStatus.CONFIRMED,
        txHash: result.txHash,
      }),
    );

    if (releasedSoFar + requested >= Number(escrow.amount) - 1e-7) {
      escrow.status = EscrowStatus.RELEASED;
      escrow.releaseTxHash = result.txHash;
      escrow.releasedAt = new Date();
      await this.escrowRepo.save(escrow);
    }

    return payment;
  }

  /** Refunds the full escrowed amount back to the original funder. */
  async refund(escrowId: string): Promise<Escrow> {
    const escrow = await this.getOrThrow(escrowId);
    this.assertLocked(escrow);

    const result = await this.soroban.invoke('refund', [
      escrow.bountyId ??
        escrow.milestoneId ??
        escrow.maintenancePoolId ??
        escrow.id,
    ]);

    escrow.status = EscrowStatus.REFUNDED;
    escrow.refundTxHash = result.txHash;
    escrow.refundedAt = new Date();
    return this.escrowRepo.save(escrow);
  }

  async findOne(id: string): Promise<Escrow> {
    return this.getOrThrow(id);
  }

  private async getOrThrow(id: string): Promise<Escrow> {
    const escrow = await this.escrowRepo.findOne({ where: { id } });
    if (!escrow) throw new NotFoundException(`Escrow ${id} not found`);
    return escrow;
  }

  private assertLocked(escrow: Escrow) {
    if (escrow.status !== EscrowStatus.LOCKED) {
      throw new BadRequestException(
        `Escrow ${escrow.id} is not in LOCKED state (current: ${escrow.status})`,
      );
    }
  }

  /** Validates that split percentages sum to 100.00, within floating point tolerance. */
  assertValidSplits(recipients: SplitRecipient[]): void {
    if (recipients.length === 0) {
      throw new BadRequestException(
        'At least one recipient is required for a split release',
      );
    }
    const total = recipients.reduce((sum, r) => sum + r.percentage, 0);
    if (Math.abs(total - 100) > 0.01) {
      throw new BadRequestException(
        `Split percentages must sum to 100, got ${total.toFixed(2)}`,
      );
    }
    if (recipients.some((r) => r.percentage <= 0)) {
      throw new BadRequestException('Split percentages must be positive');
    }
  }

  private roundAmount(value: number): number {
    return Math.round(value * 1e7) / 1e7;
  }

  private assertValidFundInput(input: FundEscrowInput): void {
    this.assertValidAmount(input.amount);
    if (!isSupportedEscrowAsset(input.asset)) {
      throw new BadRequestException(
        `Unsupported escrow asset: ${String(input.asset)}`,
      );
    }
  }

  private assertValidAmount(amount: string): void {
    if (!isValidMoneyAmount(amount)) {
      throw new BadRequestException(
        'Amount must be a positive decimal string with at most 7 fractional digits and no more than 100000000',
      );
    }
  }

  private toStroops(amount: string): bigint {
    return amountToStroops(amount);
  }
}
