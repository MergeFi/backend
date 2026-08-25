import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { Escrow, EscrowStatus } from '../common/entities/escrow.entity';
import { Payment, PaymentStatus, PaymentType } from '../common/entities/payment.entity';
import { SorobanClientService } from './soroban-client.service';
import { FundEscrowDto } from './dto/fund-escrow.dto';
import { ReleaseEscrowDto } from './dto/release-escrow.dto';
import { SplitReleaseDto } from './dto/split-release.dto';

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    @Inject('ESCROW_REPOSITORY')
    private readonly escrowRepo: typeof Escrow,
    @Inject('PAYMENT_REPOSITORY')
    private readonly paymentRepo: typeof Payment,
    private readonly soroban: SorobanClientService,
    private readonly dataSource: DataSource,
  ) {}

  private toStroops(amount: string): string {
    return (Number(amount) * 10_000_000).toFixed(0);
  }

  private fromStroops(stroops: string): string {
    return (Number(stroops) / 10_000_000).toFixed(7);
  }

  async fund(input: FundEscrowDto): Promise<Escrow> {
    const escrow = this.escrowRepo.create({
      id: input.escrowId,
      parentType: input.parentType,
      parentId: input.parentId,
      funderAddress: input.funderAddress,
      amount: input.amount,
      status: EscrowStatus.PENDING,
      metadata: {},
    });
    await this.escrowRepo.save(escrow);

    let result: { txHash: string; ledger: number; returnValue: unknown; status: string };
    try {
      const referenceId = input.bountyId ?? input.milestoneId ?? input.maintenancePoolId ?? escrow.id;
      result = await this.soroban.invoke('fund', [
        input.funderAddress,
        referenceId,
        this.toStroops(input.amount),
      ]);
    } catch (err) {
      escrow.status = EscrowStatus.FAILED;
      escrow.metadata = { error: (err as Error).message };
      await this.escrowRepo.save(escrow);
      throw err;
    }

    // Soroban invoke succeeded — now persist the LOCKED state
    escrow.status = EscrowStatus.LOCKED;
    escrow.fundTxHash = result.txHash;
    escrow.lockedAt = new Date();
    escrow.metadata = { fund: result };
    try {
      return await this.escrowRepo.save(escrow);
    } catch (dbErr) {
      // On-chain succeeded, local persist failed — do NOT mark FAILED
      this.logger.error(
        `ESCROW FUND: on-chain succeeded but DB persist failed — escrow ${escrow.id} is LOCKED on-chain (tx: ${result.txHash}) but not reflected locally. Error: ${(dbErr as Error).message}`,
      );
      // Attach the txHash to the error for upstream handling / reconciliation
      const enrichedError = new Error(`DB persist failed after successful on-chain fund: ${(dbErr as Error).message}`);
      (enrichedError as any).txHash = result.txHash;
      (enrichedError as any).escrowId = escrow.id;
      (enrichedError as any).onChainStatus = 'LOCKED';
      throw enrichedError;
    }
  }

  async release(input: ReleaseEscrowDto): Promise<Escrow> {
    const escrow = await this.escrowRepo.findOneOrFail({ where: { id: input.escrowId } });
    if (escrow.status !== EscrowStatus.LOCKED) {
      throw new Error(`Escrow ${escrow.id} is not LOCKED (current: ${escrow.status})`);
    }

    let result: { txHash: string; ledger: number; returnValue: unknown; status: string };
    try {
      result = await this.soroban.invoke('release', [
        escrow.funderAddress,
        input.recipientAddress,
        this.toStroops(input.amount),
        escrow.fundTxHash,
      ]);
    } catch (err) {
      escrow.status = EscrowStatus.FAILED;
      escrow.metadata = { ...escrow.metadata, error: (err as Error).message };
      await this.escrowRepo.save(escrow);
      throw err;
    }

    // Soroban invoke succeeded — now persist the RELEASED state and create payment
    escrow.status = EscrowStatus.RELEASED;
    escrow.releaseTxHash = result.txHash;
    escrow.releasedAt = new Date();
    escrow.metadata = { ...escrow.metadata, release: result };

    const payment = this.paymentRepo.create({
      escrowId: escrow.id,
      recipientAddress: input.recipientAddress,
      amount: input.amount,
      type: PaymentType.RELEASE,
      status: PaymentStatus.COMPLETED,
      txHash: result.txHash,
      metadata: { release: result },
    });

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.save(escrow);
        await manager.save(payment);
      });
      return escrow;
    } catch (dbErr) {
      this.logger.error(
        `ESCROW RELEASE: on-chain succeeded but DB persist failed — escrow ${escrow.id} is RELEASED on-chain (tx: ${result.txHash}) but not reflected locally. Error: ${(dbErr as Error).message}`,
      );
      const enrichedError = new Error(`DB persist failed after successful on-chain release: ${(dbErr as Error).message}`);
      (enrichedError as any).txHash = result.txHash;
      (enrichedError as any).escrowId = escrow.id;
      (enrichedError as any).onChainStatus = 'RELEASED';
      throw enrichedError;
    }
  }

  async splitRelease(input: SplitReleaseDto): Promise<Escrow> {
    const escrow = await this.escrowRepo.findOneOrFail({ where: { id: input.escrowId } });
    if (escrow.status !== EscrowStatus.LOCKED) {
      throw new Error(`Escrow ${escrow.id} is not LOCKED (current: ${escrow.status})`);
    }

    let result: { txHash: string; ledger: number; returnValue: unknown; status: string };
    try {
      result = await this.soroban.invoke('split_release', [
        escrow.funderAddress,
        input.splits.map((s) => s.recipientAddress),
        input.splits.map((s) => this.toStroops(s.amount)),
        escrow.fundTxHash,
      ]);
    } catch (err) {
      escrow.status = EscrowStatus.FAILED;
      escrow.metadata = { ...escrow.metadata, error: (err as Error).message };
      await this.escrowRepo.save(escrow);
      throw err;
    }

    // Soroban invoke succeeded — now persist the RELEASED state and create payments
    escrow.status = EscrowStatus.RELEASED;
    escrow.releaseTxHash = result.txHash;
    escrow.releasedAt = new Date();
    escrow.metadata = { ...escrow.metadata, splitRelease: result };

    const payments = input.splits.map((split) =>
      this.paymentRepo.create({
        escrowId: escrow.id,
        recipientAddress: split.recipientAddress,
        amount: split.amount,
        type: PaymentType.SPLIT_RELEASE,
        status: PaymentStatus.COMPLETED,
        txHash: result.txHash,
        metadata: { splitRelease: result, split },
      }),
    );

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.save(escrow);
        await manager.save(payments);
      });
      return escrow;
    } catch (dbErr) {
      this.logger.error(
        `ESCROW SPLIT_RELEASE: on-chain succeeded but DB persist failed — escrow ${escrow.id} is RELEASED on-chain (tx: ${result.txHash}) but not reflected locally. Error: ${(dbErr as Error).message}`,
      );
      const enrichedError = new Error(`DB persist failed after successful on-chain split release: ${(dbErr as Error).message}`);
      (enrichedError as any).txHash = result.txHash;
      (enrichedError as any).escrowId = escrow.id;
      (enrichedError as any).onChainStatus = 'RELEASED';
      throw enrichedError;
    }
  }

  async releasePartial(input: ReleaseEscrowDto): Promise<Escrow> {
    const escrow = await this.escrowRepo.findOneOrFail({ where: { id: input.escrowId } });
    if (escrow.status !== EscrowStatus.LOCKED && escrow.status !== EscrowStatus.PARTIALLY_RELEASED) {
      throw new Error(`Escrow ${escrow.id} is not LOCKED or PARTIALLY_RELEASED (current: ${escrow.status})`);
    }

    let result: { txHash: string; ledger: number; returnValue: unknown; status: string };
    try {
      result = await this.soroban.invoke('release', [
        escrow.funderAddress,
        input.recipientAddress,
        this.toStroops(input.amount),
        escrow.fundTxHash,
      ]);
    } catch (err) {
      escrow.status = EscrowStatus.FAILED;
      escrow.metadata = { ...escrow.metadata, error: (err as Error).message };
      await this.escrowRepo.save(escrow);
      throw err;
    }

    // Soroban invoke succeeded — now persist the PARTIALLY_RELEASED state and create payment
    const isFullyReleased = Number(input.amount) >= Number(escrow.amount);
    escrow.status = isFullyReleased ? EscrowStatus.RELEASED : EscrowStatus.PARTIALLY_RELEASED;
    escrow.releaseTxHash = result.txHash;
    escrow.releasedAt = new Date();
    escrow.metadata = { ...escrow.metadata, partialRelease: result };

    const payment = this.paymentRepo.create({
      escrowId: escrow.id,
      recipientAddress: input.recipientAddress,
      amount: input.amount,
      type: PaymentType.PARTIAL_RELEASE,
      status: PaymentStatus.COMPLETED,
      txHash: result.txHash,
      metadata: { partialRelease: result },
    });

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.save(escrow);
        await manager.save(payment);
      });
      return escrow;
    } catch (dbErr) {
      this.logger.error(
        `ESCROW PARTIAL_RELEASE: on-chain succeeded but DB persist failed — escrow ${escrow.id} is ${isFullyReleased ? 'RELEASED' : 'PARTIALLY_RELEASED'} on-chain (tx: ${result.txHash}) but not reflected locally. Error: ${(dbErr as Error).message}`,
      );
      const enrichedError = new Error(`DB persist failed after successful on-chain partial release: ${(dbErr as Error).message}`);
      (enrichedError as any).txHash = result.txHash;
      (enrichedError as any).escrowId = escrow.id;
      (enrichedError as any).onChainStatus = isFullyReleased ? 'RELEASED' : 'PARTIALLY_RELEASED';
      throw enrichedError;
    }
  }

  async refund(input: { escrowId: string }): Promise<Escrow> {
    const escrow = await this.escrowRepo.findOneOrFail({ where: { id: input.escrowId } });
    if (escrow.status !== EscrowStatus.LOCKED && escrow.status !== EscrowStatus.PARTIALLY_RELEASED) {
      throw new Error(`Escrow ${escrow.id} is not refundable (current: ${escrow.status})`);
    }

    let result: { txHash: string; ledger: number; returnValue: unknown; status: string };
    try {
      result = await this.soroban.invoke('refund', [
        escrow.funderAddress,
        escrow.fundTxHash,
      ]);
    } catch (err) {
      escrow.status = EscrowStatus.FAILED;
      escrow.metadata = { ...escrow.metadata, error: (err as Error).message };
      await this.escrowRepo.save(escrow);
      throw err;
    }

    // Soroban invoke succeeded — now persist the REFUNDED state
    escrow.status = EscrowStatus.REFUNDED;
    escrow.refundTxHash = result.txHash;
    escrow.refundedAt = new Date();
    escrow.metadata = { ...escrow.metadata, refund: result };

    try {
      return await this.escrowRepo.save(escrow);
    } catch (dbErr) {
      this.logger.error(
        `ESCROW REFUND: on-chain succeeded but DB persist failed — escrow ${escrow.id} is REFUNDED on-chain (tx: ${result.txHash}) but not reflected locally. Error: ${(dbErr as Error).message}`,
      );
      const enrichedError = new Error(`DB persist failed after successful on-chain refund: ${(dbErr as Error).message}`);
      (enrichedError as any).txHash = result.txHash;
      (enrichedError as any).escrowId = escrow.id;
      (enrichedError as any).onChainStatus = 'REFUNDED';
      throw enrichedError;
    }
  }
}
