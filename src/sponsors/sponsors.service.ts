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
  async activeBounties(sponsorId: string): Promise<Bounty[]> {
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

  async activeMilestones(sponsorId: string): Promise<Milestone[]> {
    return this.milestoneRepo.find({
      where: [
        { sponsorId, status: MilestoneStatus.FUNDED },
        { sponsorId, status: MilestoneStatus.IN_PROGRESS },
      ],
    });
  }

  /** Progress (0-1) of every milestone this sponsor funded: distributed / budget. */
  async milestoneProgress(
    sponsorId: string,
  ): Promise<Array<{ milestoneId: string; title: string; progress: number }>> {
    const milestones = await this.milestoneRepo.find({ where: { sponsorId } });
    return milestones.map((m) => ({
      milestoneId: m.id,
      title: m.title,
      progress:
        Number(m.budget) > 0 ? Number(m.distributed) / Number(m.budget) : 0,
    }));
  }

  async dashboard(sponsorId: string): Promise<SponsorDashboard> {
    const [activeBounties, totalSpent, budgetLocked, activeMilestones] =
      await Promise.all([
        this.activeBounties(sponsorId),
        this.totalSpend(sponsorId),
        this.budgetLocked(sponsorId),
        this.activeMilestones(sponsorId),
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
      .take(20)
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
