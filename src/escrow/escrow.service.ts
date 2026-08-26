import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Escrow, Payment, User } from '../common/entities';
import { AssetType, EscrowStatus, PaymentStatus } from '../common/enums';
import {
  amountToStroops,
  isSupportedEscrowAsset,
  isValidMoneyAmount,
  stroopsToAmount,
} from '../common/validators/money.validator';
import { SorobanClientService } from './soroban-client.service';
import { apportionBasisPoints, splitStroops } from './split-math.util';

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
    @InjectRepository(User) private readonly userRepo: Repository<User>,
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
    await this.assertRecipientsMatchUsers([{ recipientAddress, recipientId }]);

    const result = await this.invokeOnLockedEscrow(escrow, 'release', () =>
      this.soroban.invoke('release', [
        escrow.bountyId ??
          escrow.milestoneId ??
          escrow.maintenancePoolId ??
          escrow.id,
        recipientAddress,
      ]),
    );

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
   *
   * The recorded `Payment.amount` values are derived from the same
   * basis-point integers sent on-chain — not recomputed independently from the
   * raw percentages — so the local ledger can never drift from what was
   * instructed to the contract. Shares are allocated in whole stroops via a
   * largest-remainder method, guaranteeing `sum(payments.amount) ===
   * escrow.amount` exactly (#43).
   */
  async splitRelease(
    escrowId: string,
    recipients: SplitRecipient[],
  ): Promise<Payment[]> {
    const escrow = await this.getOrThrow(escrowId);
    this.assertLocked(escrow);
    this.assertValidSplits(recipients);
    await this.assertRecipientsMatchUsers(recipients);

    const totalStroops = amountToStroops(escrow.amount);
    // Single source of truth for the split: integer basis points summing to
    // exactly 10,000 (100.00%), used both on-chain and to derive the ledger.
    const bps = apportionBasisPoints(recipients.map((r) => r.percentage));

    const result = await this.invokeOnLockedEscrow(escrow, 'splitRelease', () =>
      this.soroban.invoke('split_release', [
        escrow.bountyId ?? escrow.milestoneId ?? escrow.id,
        recipients.map((r) => r.recipientAddress),
        bps,
      ]),
    );

    const shares = splitStroops(totalStroops, bps);
    this.reconcileSplitResult(escrow.id, totalStroops, result.returnValue);

    escrow.status = EscrowStatus.RELEASED;
    escrow.releaseTxHash = result.txHash;
    escrow.releasedAt = new Date();
    escrow.metadata = { ...(escrow.metadata ?? {}), splitRelease: result };
    await this.escrowRepo.save(escrow);

    const payments: Payment[] = [];
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const payment = this.paymentRepo.create({
        escrowId: escrow.id,
        recipientId: recipient.recipientId ?? null,
        recipientAddress: recipient.recipientAddress,
        amount: stroopsToAmount(shares[i]),
        asset: escrow.asset,
        splitPercentage: (bps[i] / 100).toFixed(2),
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

    await this.assertRecipientsMatchUsers([{ recipientAddress, recipientId }]);

    const result = await this.invokeOnLockedEscrow(
      escrow,
      'releasePartial',
      () =>
        this.soroban.invoke('release', [
          escrow.milestoneId ?? escrow.bountyId ?? escrow.id,
          recipientAddress,
          this.toStroops(amount),
        ]),
    );

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

  /**
   * Pays a reward out of a maintenance pool's running balance.
   *
   * The real `mergefi-maintenance-pool` contract has no
   * LOCKED-escrow-with-partial-release concept: it accrues an on-chain
   * `balance` through repeated `deposit()` calls and pays out via
   * `withdraw(pool_id, recipient, amount)` against the live balance, with no
   * pre-`lock` step and no "fully released" terminal state (#163).
   *
   * So unlike {@link releasePartial} — which is milestone-shaped: it checks
   * the cumulative payouts against a fixed locked `escrow.amount` and flips
   * the escrow to RELEASED once they reach it — this call:
   *   - invokes the pool contract's `withdraw`, not `release`;
   *   - leaves the escrow row LOCKED (it mirrors an open, still-funded pool,
   *     not a one-off lock that closes out);
   *   - does not enforce a ceiling here. The spendable balance is tracked by
   *     `MaintenancePoolService` on `pool.balance` and checked there before
   *     this is called.
   */
  async poolWithdraw(
    escrowId: string,
    amount: string,
    recipientAddress: string,
    recipientId?: string,
  ): Promise<Payment> {
    const escrow = await this.getOrThrow(escrowId);
    this.assertLocked(escrow);
    this.assertValidAmount(amount);
    await this.assertRecipientsMatchUsers([{ recipientAddress, recipientId }]);

    const result = await this.invokeOnLockedEscrow(escrow, 'poolWithdraw', () =>
      this.soroban.invoke('withdraw', [
        escrow.maintenancePoolId ?? escrow.id,
        recipientAddress,
        this.toStroops(amount),
      ]),
    );

    return this.paymentRepo.save(
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
  }

  /** Refunds the full escrowed amount back to the original funder. */
  async refund(escrowId: string): Promise<Escrow> {
    const escrow = await this.getOrThrow(escrowId);
    this.assertLocked(escrow);

    const result = await this.invokeOnLockedEscrow(escrow, 'refund', () =>
      this.soroban.invoke('refund', [
        escrow.bountyId ??
          escrow.milestoneId ??
          escrow.maintenancePoolId ??
          escrow.id,
      ]),
    );

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

  /**
   * recipientId and recipientAddress must describe the same payee: whenever a
   * user id is supplied, its address is required to match the Stellar address
   * on file for that user (#92). Without this cross-check, on-chain funds
   * could go to an unrelated address while Payment rows attribute them to the
   * given user id.
   */
  private async assertRecipientsMatchUsers(
    recipients: { recipientAddress: string; recipientId?: string }[],
  ): Promise<void> {
    const ids = [
      ...new Set(
        recipients
          .map((r) => r.recipientId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (ids.length === 0) return;

    const users = await this.userRepo.find({ where: { id: In(ids) } });
    const byId = new Map(users.map((u) => [u.id, u]));

    for (const r of recipients) {
      if (!r.recipientId) continue;
      const onFile = byId.get(r.recipientId)?.stellarAddress ?? null;
      if (!onFile || onFile !== r.recipientAddress) {
        throw new BadRequestException(
          `recipientAddress does not match the Stellar address on file for user ${r.recipientId}`,
        );
      }
    }
  }

  /**
   * Runs a Soroban invocation against an already-LOCKED escrow and records a
   * thrown failure in escrow.metadata so failed attempts are queryable state
   * rather than only a server log line (#89). The status deliberately stays
   * LOCKED — the funds are still held and the operation can be retried.
   */
  private async invokeOnLockedEscrow<T>(
    escrow: Escrow,
    operation: string,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (err) {
      escrow.metadata = {
        ...(escrow.metadata ?? {}),
        lastFailure: {
          operation,
          error: (err as Error).message,
          at: new Date().toISOString(),
        },
      };
      await this.escrowRepo.save(escrow);
      throw err;
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

  /**
   * The illustrative split_release contract returns a single i128 (the total
   * released, in stroops) rather than a per-recipient breakdown, so the
   * recorded Payment rows cannot yet be derived from `result.returnValue`
   * (see the interface TODO in soroban-client.service.ts). Until the deployed
   * contract returns per-recipient amounts, reconcile the scalar total against
   * the locally computed total and surface any divergence as a warning for the
   * reconciliation job, rather than silently discarding it (#43).
   */
  private reconcileSplitResult(
    escrowId: string,
    totalStroops: bigint,
    returnValue: unknown,
  ): void {
    const returned = this.toStroopsFromReturnValue(returnValue);
    if (returned === null) return;
    if (returned !== totalStroops) {
      this.logger.warn(
        `split_release returnValue (${returned} stroops) diverges from the ` +
          `recorded total (${totalStroops} stroops) for escrow ${escrowId}`,
      );
    }
  }

  /** Best-effort conversion of a contract return value to a stroop total. */
  private toStroopsFromReturnValue(value: unknown): bigint | null {
    if (value == null) return null;
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      return BigInt(value.trim());
    }
    return null;
  }

  private assertValidFundInput(input: FundEscrowInput): void {
    this.assertValidAmount(input.amount);
    if (!isSupportedEscrowAsset(input.asset)) {
      throw new BadRequestException(
        `Unsupported escrow asset: ${String(input.asset)}`,
      );
    }
    this.assertExactlyOneParent(input);
  }

  /**
   * A newly-created escrow must belong to exactly one of
   * bounty/milestone/maintenancePool. This is deliberately an
   * application-level check rather than a DB CHECK constraint: the
   * database only enforces "at most one" (CHK_escrow_at_most_one_parent),
   * because ON DELETE SET NULL legitimately drives an existing escrow's
   * parent count to zero when its parent is deleted, and a stricter
   * "exactly one" constraint would make that very SET NULL fail (#27).
   */
  private assertExactlyOneParent(input: FundEscrowInput): void {
    const parentCount = [
      input.bountyId,
      input.milestoneId,
      input.maintenancePoolId,
    ].filter((id) => id != null).length;
    if (parentCount !== 1) {
      throw new BadRequestException(
        'Exactly one of bountyId, milestoneId, or maintenancePoolId is required',
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
