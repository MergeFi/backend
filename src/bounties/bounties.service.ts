import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Bounty, Team, User } from '../common/entities';
import { AssetType, BountyDifficulty, BountyStatus } from '../common/enums';
import { ANALYTICS_PLATFORM_INVALIDATE_EVENT } from '../analytics/analytics.events';
import { assertTransition } from './bounty-state-machine';
import { EscrowService } from '../escrow/escrow.service';
import { CreateBountyDto } from './dto/create-bounty.dto';

export interface ListBountiesOptions {
  status?: BountyStatus;
  difficulty?: BountyDifficulty;
  asset?: AssetType;
  repositoryId?: string;
  primaryLanguage?: string;
}

@Injectable()
export class BountiesService {
  constructor(
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Team) private readonly teamRepo: Repository<Team>,
    private readonly escrowService: EscrowService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  async create(dto: CreateBountyDto): Promise<Bounty> {
    const bounty = this.bountyRepo.create({
      issueId: dto.issueId,
      sponsorId: dto.sponsorId,
      amount: dto.amount,
      asset: dto.asset,
      difficulty: dto.difficulty,
      deadline: dto.deadline ? new Date(dto.deadline) : null,
      status: BountyStatus.OPEN,
    });
    const saved = await this.bountyRepo.save(bounty);
    this.eventEmitter?.emit(ANALYTICS_PLATFORM_INVALIDATE_EVENT);
    return saved;
  }

  async findOne(id: string): Promise<Bounty> {
    const bounty = await this.bountyRepo.findOne({ where: { id } });
    if (!bounty) throw new NotFoundException(`Bounty ${id} not found`);
    return bounty;
  }

  /** Sponsor funds the bounty: locks the amount in the escrow contract and moves OPEN -> FUNDED. */
  async fund(id: string, funderAddress: string): Promise<Bounty> {
    const bounty = await this.bountyRepo.findOne({
      where: { id },
      relations: { issue: true },
    });
    if (!bounty) throw new NotFoundException(`Bounty ${id} not found`);
    assertTransition(bounty.status, BountyStatus.FUNDED);

    const escrow = await this.escrowService.fund({
      amount: bounty.amount,
      asset: bounty.asset,
      funderAddress,
      bountyId: bounty.id,
      sponsorId: bounty.sponsorId,
      // The on-chain escrow contract is keyed by the GitHub issue id (#158).
      onChainIssueId: bounty.issue?.githubIssueId ?? null,
      deadline: bounty.deadline,
    });

    bounty.escrow = escrow;
    bounty.escrowId = escrow.id;
    bounty.status = BountyStatus.FUNDED;
    return this.bountyRepo.save(bounty);
  }

  /** Contributor claims a funded bounty. */
  async claim(id: string, contributorId: string): Promise<Bounty> {
    const bounty = await this.findOne(id);
    assertTransition(bounty.status, BountyStatus.CLAIMED);

    bounty.claimedById = contributorId;
    bounty.status = BountyStatus.CLAIMED;
    bounty.claimedAt = new Date();
    return this.bountyRepo.save(bounty);
  }

  /** A PR referencing the issue was opened. */
  async markInReview(
    id: string,
    prUrl: string,
    prNumber: number,
  ): Promise<Bounty> {
    const bounty = await this.findOne(id);
    assertTransition(bounty.status, BountyStatus.IN_REVIEW);

    bounty.status = BountyStatus.IN_REVIEW;
    bounty.prUrl = prUrl;
    bounty.prNumber = prNumber;
    return this.bountyRepo.save(bounty);
  }

  /** The linked PR was closed without merging — move bounty back to CLAIMED. */
  async markPrClosedWithoutMerge(id: string): Promise<Bounty> {
    const bounty = await this.findOne(id);
    assertTransition(bounty.status, BountyStatus.CLAIMED);

    bounty.status = BountyStatus.CLAIMED;
    bounty.prUrl = null;
    bounty.prNumber = null;
    return this.bountyRepo.save(bounty);
  }

  /**
   * The linked PR was merged on GitHub. Transitions to MERGED and immediately
   * triggers the escrow release (single recipient or team split), moving to
   * PAID once the on-chain release call succeeds.
   */
  async markMergedAndRelease(id: string): Promise<Bounty> {
    const bounty = await this.findOne(id);
    assertTransition(bounty.status, BountyStatus.MERGED);

    bounty.status = BountyStatus.MERGED;
    bounty.mergedAt = new Date();
    await this.bountyRepo.save(bounty);

    if (!bounty.escrowId) {
      // No escrow was ever funded (e.g. informally tracked bounty) — nothing to release.
      return bounty;
    }

    if (bounty.teamId) {
      const team = await this.teamRepo.findOne({
        where: { id: bounty.teamId },
        relations: { splits: true },
      });
      if (team && team.splits.length > 0) {
        const userIds = team.splits.map((s) => s.userId);
        const users = await this.userRepo.find({
          where: { id: In(userIds) },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));
        const recipients = team.splits.map((split) => {
          const user = userMap.get(split.userId);
          return {
            recipientId: split.userId,
            recipientAddress: user?.stellarAddress ?? '',
            percentage: Number(split.percentage),
          };
        });
        await this.escrowService.splitRelease(bounty.escrowId, recipients);
      }
    } else if (bounty.claimedById) {
      const contributor = await this.userRepo.findOne({
        where: { id: bounty.claimedById },
      });
      await this.escrowService.release(
        bounty.escrowId,
        contributor?.stellarAddress ?? '',
        bounty.claimedById,
      );
    }

    assertTransition(bounty.status, BountyStatus.PAID);
    bounty.status = BountyStatus.PAID;
    bounty.paidAt = new Date();
    const paid = await this.bountyRepo.save(bounty);
    this.eventEmitter?.emit(ANALYTICS_PLATFORM_INVALIDATE_EVENT);
    return paid;
  }

  /** Sponsor (or admin/expiry job) reclaims escrowed funds. */
  async refund(id: string): Promise<Bounty> {
    const bounty = await this.findOne(id);
    assertTransition(bounty.status, BountyStatus.REFUNDED);

    if (bounty.escrowId) {
      await this.escrowService.refund(bounty.escrowId);
    }

    bounty.status = BountyStatus.REFUNDED;
    return this.bountyRepo.save(bounty);
  }

  /** Marks bounties whose deadline has passed and that were never merged as expired. */
  async expireOverdue(): Promise<number> {
    const overdue = await this.bountyRepo
      .createQueryBuilder('bounty')
      .where('bounty.deadline IS NOT NULL AND bounty.deadline < :now', {
        now: new Date(),
      })
      .andWhere('bounty.status IN (:...statuses)', {
        statuses: [
          BountyStatus.OPEN,
          BountyStatus.FUNDED,
          BountyStatus.CLAIMED,
        ],
      })
      .getMany();

    for (const bounty of overdue) {
      bounty.status = BountyStatus.EXPIRED;
      await this.bountyRepo.save(bounty);
    }
    return overdue.length;
  }

  async list(options: ListBountiesOptions = {}): Promise<Bounty[]> {
    const qb = this.bountyRepo
      .createQueryBuilder('bounty')
      .leftJoinAndSelect('bounty.issue', 'issue')
      .leftJoinAndSelect('issue.repository', 'repository');

    if (options.status) {
      qb.andWhere('bounty.status = :status', { status: options.status });
    }
    if (options.difficulty) {
      qb.andWhere('bounty.difficulty = :difficulty', {
        difficulty: options.difficulty,
      });
    }
    if (options.asset) {
      qb.andWhere('bounty.asset = :asset', { asset: options.asset });
    }
    if (options.repositoryId) {
      qb.andWhere('issue.repositoryId = :repositoryId', {
        repositoryId: options.repositoryId,
      });
    }
    if (options.primaryLanguage) {
      qb.andWhere('repository.primaryLanguage = :primaryLanguage', {
        primaryLanguage: options.primaryLanguage,
      });
    }

    return qb.getMany();
  }

   approve(id: string) {
    return Promise.resolve({ id, status: 'approved' });
  }

  reject(id: string) {
    return Promise.resolve({ id, status: 'rejected' });
  }
}
