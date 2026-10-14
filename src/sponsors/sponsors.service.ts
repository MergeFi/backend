import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, Escrow, Milestone, Payment } from '../common/entities';
import {
  BountyStatus,
  EscrowStatus,
  MilestoneStatus,
  PaymentStatus,
} from '../common/enums';

export interface SponsorDashboard {
  activeBounties: Bounty[];
  /** @deprecated sums USDC and XLM into one meaningless number — use totalSpentByAsset (#574). */
  totalSpent: number;
  /** @deprecated sums USDC and XLM into one meaningless number — use budgetLockedByAsset (#574). */
  budgetLocked: number;
  /** Per-asset spend: {USDC: n, XLM: n} — the currency-correct totals. */
  totalSpentByAsset: Record<string, number>;
  /** Per-asset locked balance: {USDC: n, XLM: n}. */
  budgetLockedByAsset: Record<string, number>;
  activeMilestones: Milestone[];
  recentPayments: Payment[];
}

export interface SponsorDashboardOptions {
  limit?: number;
  offset?: number;
}

@Injectable()
export class SponsorsService {
  constructor(
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(Milestone)
    private readonly milestoneRepo: Repository<Milestone>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Escrow)
    private readonly escrowRepo: Repository<Escrow>,
  ) {}

  /** Bounties this sponsor has created that are still in flight (not paid/refunded/expired). */
  async activeBounties(
    sponsorId: string,
    options: SponsorDashboardOptions = {},
  ): Promise<Bounty[]> {
    return this.bountyRepo
      .createQueryBuilder('bounty')
      .where('bounty.sponsorId = :sponsorId', { sponsorId })
      .andWhere('bounty.status NOT IN (:...terminal)', {
        terminal: [
          BountyStatus.PAID,
          BountyStatus.REFUNDED,
          BountyStatus.EXPIRED,
        ],
      })
      .take(options.limit ?? 20)
      .skip(options.offset ?? 0)
      .getMany();
  }

  /**
   * Total amount actually paid out to this sponsor's contributors, summed
   * directly from the Payment ledger (the source of truth for money that
   * moved) rather than `Bounty.status`, which is a workflow-state proxy that
   * can drift from the real escrow/payment history. Joins through
   * `escrow.sponsorId` (denormalized at fund time — see Escrow entity) so
   * this stays correct even if the parent bounty/milestone is later deleted
   * (#27).
   */
  /**
   * Per-asset spend — a sponsor who paid 100 USDC and 100 XLM was previously
   * shown "totalSpent: 200", a meaningless sum of unlike currencies (#574).
   * Group by the escrow's asset so the total stays meaningful per currency.
   */
  async totalSpendByAsset(sponsorId: string): Promise<Record<string, number>> {
    const rows = await this.paymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.escrow', 'escrow')
      .select('escrow.asset', 'asset')
      .addSelect('COALESCE(SUM(payment.amount), 0)', 'total')
      .where('escrow.sponsorId = :sponsorId', { sponsorId })
      .andWhere('payment.status = :status', {
        status: PaymentStatus.CONFIRMED,
      })
      .groupBy('escrow.asset')
      .getRawMany<{ asset: string; total: string }>();
    return Object.fromEntries(rows.map((r) => [r.asset, Number(r.total)]));
  }

  async totalSpend(sponsorId: string): Promise<number> {
    const row = await this.paymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.escrow', 'escrow')
      .select('COALESCE(SUM(payment.amount), 0)', 'total')
      .where('escrow.sponsorId = :sponsorId', { sponsorId })
      .andWhere('payment.status = :status', {
        status: PaymentStatus.CONFIRMED,
      })
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  /**
   * Amount currently locked in escrow for this sponsor, summed directly
   * from the Escrow ledger (source of truth) rather than `Bounty.amount`
   * filtered by `Bounty.status`. The prior implementation only considered
   * bounty-funded escrows and depended on the parent Bounty row surviving;
   * this reads `Escrow.status`/`Escrow.sponsorId` directly, so it covers
   * milestone-funded escrows too and remains correct even if the parent
   * bounty/milestone is later deleted (#27).
   */
  async budgetLocked(sponsorId: string): Promise<number> {
    const row = await this.escrowRepo
      .createQueryBuilder('escrow')
      .select('COALESCE(SUM(escrow.amount), 0)', 'total')
      .where('escrow.sponsorId = :sponsorId', { sponsorId })
      .andWhere('escrow.status = :status', { status: EscrowStatus.LOCKED })
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  /** Per-asset locked-balance — see #574 (unlike currencies must not sum). */
  async budgetLockedByAsset(
    sponsorId: string,
  ): Promise<Record<string, number>> {
    const rows = await this.escrowRepo
      .createQueryBuilder('escrow')
      .select('escrow.asset', 'asset')
      .addSelect('COALESCE(SUM(escrow.amount), 0)', 'total')
      .where('escrow.sponsorId = :sponsorId', { sponsorId })
      .andWhere('escrow.status = :status', { status: EscrowStatus.LOCKED })
      .groupBy('escrow.asset')
      .getRawMany<{ asset: string; total: string }>();
    return Object.fromEntries(rows.map((r) => [r.asset, Number(r.total)]));
  }

  async activeMilestones(
    sponsorId: string,
    options: SponsorDashboardOptions = {},
  ): Promise<Milestone[]> {
    return this.milestoneRepo.find({
      where: [
        { sponsorId, status: MilestoneStatus.FUNDED },
        { sponsorId, status: MilestoneStatus.IN_PROGRESS },
      ],
      take: options.limit ?? 20,
      skip: options.offset ?? 0,
    });
  }

  /** Progress (0-1) of every milestone this sponsor funded: distributed / budget. */
  async milestoneProgress(
    sponsorId: string,
    options: SponsorDashboardOptions = {},
  ): Promise<Array<{ milestoneId: string; title: string; progress: number }>> {
    const milestones = await this.milestoneRepo.find({
      where: { sponsorId },
      take: options.limit ?? 20,
      skip: options.offset ?? 0,
    });
    return milestones.map((m) => ({
      milestoneId: m.id,
      title: m.title,
      progress:
        Number(m.budget) > 0 ? Number(m.distributed) / Number(m.budget) : 0,
    }));
  }

  async dashboard(
    sponsorId: string,
    options: SponsorDashboardOptions = {},
  ): Promise<SponsorDashboard> {
    const [
      activeBounties,
      totalSpent,
      budgetLocked,
      activeMilestones,
      totalSpentByAsset,
      budgetLockedByAsset,
    ] = await Promise.all([
      this.activeBounties(sponsorId, options),
      this.totalSpend(sponsorId),
      this.budgetLocked(sponsorId),
      this.activeMilestones(sponsorId, options),
      // Per-asset breakdowns (#574) — the single numbers above sum unlike
      // currencies; these group by asset so USDC and XLM stay separate.
      this.totalSpendByAsset(sponsorId),
      this.budgetLockedByAsset(sponsorId),
    ]);

    // Joins on escrow.sponsorId directly (not escrow.bounty.sponsorId): the
    // old join required the escrow's parent bounty row to still exist and
    // silently excluded milestone-funded payments entirely. sponsorId lives
    // on the escrow itself, so this covers both funding paths and survives
    // parent-bounty deletion (#27).
    const recentPayments = await this.paymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.escrow', 'escrow')
      .where('escrow.sponsorId = :sponsorId', { sponsorId })
      .orderBy('payment.createdAt', 'DESC')
      .take(options.limit ?? 20)
      .skip(options.offset ?? 0)
      .getMany();

    return {
      activeBounties,
      totalSpent,
      budgetLocked,
      totalSpentByAsset,
      budgetLockedByAsset,
      activeMilestones,
      recentPayments,
    };
  }
}
