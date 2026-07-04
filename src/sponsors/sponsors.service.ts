import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, Milestone, Payment } from '../common/entities';
import { BountyStatus, MilestoneStatus } from '../common/enums';

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

  /** Total amount this sponsor has paid out across all completed bounties. */
  async totalSpend(sponsorId: string): Promise<number> {
    const row = await this.bountyRepo
      .createQueryBuilder('bounty')
      .select('COALESCE(SUM(bounty.amount), 0)', 'total')
      .where('bounty.sponsorId = :sponsorId', { sponsorId })
      .andWhere('bounty.status = :status', { status: BountyStatus.PAID })
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  /** Amount currently locked in escrow for this sponsor's funded-but-unpaid bounties. */
  async budgetLocked(sponsorId: string): Promise<number> {
    const row = await this.bountyRepo
      .createQueryBuilder('bounty')
      .select('COALESCE(SUM(bounty.amount), 0)', 'total')
      .where('bounty.sponsorId = :sponsorId', { sponsorId })
      .andWhere('bounty.status IN (:...locked)', {
        locked: [
          BountyStatus.FUNDED,
          BountyStatus.CLAIMED,
          BountyStatus.IN_REVIEW,
          BountyStatus.MERGED,
        ],
      })
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

    const recentPayments = await this.paymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.escrow', 'escrow')
      .innerJoin('escrow.bounty', 'bounty')
      .where('bounty.sponsorId = :sponsorId', { sponsorId })
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
