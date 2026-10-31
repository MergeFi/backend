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
  totalSpent: number;
  budgetLocked: number;
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
    return (
      this.bountyRepo
        .createQueryBuilder('bounty')
        .where('bounty.sponsorId = :sponsorId', { sponsorId })
        .andWhere('bounty.status NOT IN (:...terminal)', {
          terminal: [
            BountyStatus.PAID,
            BountyStatus.REFUNDED,
            BountyStatus.EXPIRED,
          ],
        })
        // Postgres has no row order without ORDER BY, so offset pages could
        // repeat or skip rows; id breaks createdAt ties (#279, #464, #573).
        .orderBy('bounty.createdAt', 'DESC')
        .addOrderBy('bounty.id', 'DESC')
        .take(options.limit ?? 20)
        .skip(options.offset ?? 0)
        .getMany()
    );
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
   * bounty/milestone is later deleted (#27). Confirmed partial payouts are
   * subtracted per escrow, so only the still-unpaid remainder counts (#575).
   */
  async budgetLocked(sponsorId: string): Promise<number> {
    // A milestone escrow stays LOCKED while releasePartial pays issues out of
    // it, so its full `amount` is not all still locked: subtract what it has
    // already paid (#575). Otherwise a 1,000 USDC escrow with 900 paid shows
    // 1,000 locked and that 900 is double-counted with totalSpend. Grouped per
    // escrow so the payment join can't multiply escrow amounts.
    const rows = await this.escrowRepo
      .createQueryBuilder('escrow')
      .leftJoin('escrow.payments', 'payment', 'payment.status = :confirmed', {
        confirmed: PaymentStatus.CONFIRMED,
      })
      .select('escrow.id', 'id')
      .addSelect('escrow.amount', 'amount')
      .addSelect('COALESCE(SUM(payment.amount), 0)', 'paid')
      .where('escrow.sponsorId = :sponsorId', { sponsorId })
      .andWhere('escrow.status = :status', { status: EscrowStatus.LOCKED })
      .groupBy('escrow.id')
      .addGroupBy('escrow.amount')
      .getRawMany<{ id: string; amount: string; paid: string }>();

    return rows.reduce(
      (sum, r) => sum + Math.max(Number(r.amount) - Number(r.paid), 0),
      0,
    );
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
      // Stable order for offset pagination (#573).
      order: { createdAt: 'DESC', id: 'DESC' },
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
      // Stable order for offset pagination (#573).
      order: { createdAt: 'DESC', id: 'DESC' },
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
    const [activeBounties, totalSpent, budgetLocked, activeMilestones] =
      await Promise.all([
        this.activeBounties(sponsorId, options),
        this.totalSpend(sponsorId),
        this.budgetLocked(sponsorId),
        this.activeMilestones(sponsorId, options),
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
      // Tie-break equal timestamps so pages stay stable (#573).
      .addOrderBy('payment.id', 'DESC')
      .take(options.limit ?? 20)
      .skip(options.offset ?? 0)
      .getMany();

    return {
      activeBounties,
      totalSpent,
      budgetLocked,
      activeMilestones,
      recentPayments,
    };
  }
}
