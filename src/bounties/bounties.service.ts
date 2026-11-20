import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Bounty, Escrow, Issue, Team, User } from '../common/entities';
import {
  AssetType,
  BountyDifficulty,
  BountyStatus,
  EscrowStatus,
} from '../common/enums';
import { ANALYTICS_PLATFORM_INVALIDATE_EVENT } from '../analytics/analytics.events';
import {
  assertTransition,
  InvalidBountyTransitionError,
} from './bounty-state-machine';
import { EscrowService } from '../escrow/escrow.service';
import { CreateBountyDto } from './dto/create-bounty.dto';

export interface ListBountiesOptions {
  status?: BountyStatus;
  difficulty?: BountyDifficulty;
  asset?: AssetType;
  repositoryId?: string;
  primaryLanguage?: string;
}

/** Statuses from which the deadline sweep may expire a bounty. */
const EXPIRABLE_STATUSES = [
  BountyStatus.OPEN,
  BountyStatus.FUNDED,
  BountyStatus.CLAIMED,
];

@Injectable()
export class BountiesService {
  private readonly logger = new Logger(BountiesService.name);

  constructor(
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Team) private readonly teamRepo: Repository<Team>,
    @InjectRepository(Issue) private readonly issueRepo: Repository<Issue>,
    private readonly escrowService: EscrowService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  async create(dto: CreateBountyDto, callerUserId: string): Promise<Bounty> {
    // Verify issueId exists
    const issueExists = await this.issueRepo.findOne({
      where: { id: dto.issueId },
    });
    if (!issueExists) {
      throw new NotFoundException(`Issue ${dto.issueId} not found`);
    }

    // Verify sponsorId exists
    const sponsorExists = await this.userRepo.findOne({
      where: { id: dto.sponsorId },
    });
    if (!sponsorExists) {
      throw new NotFoundException(`Sponsor ${dto.sponsorId} not found`);
    }

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
    const bounty = await this.bountyRepo.findOne({
      where: { id },
      relations: {
        issue: { repository: true },
        claimedBy: true,
        team: { splits: true },
      },
    });
    if (!bounty) throw new NotFoundException(`Bounty ${id} not found`);
    return bounty;
  }

  /** Sponsor funds the bounty: locks the amount in the escrow contract and moves OPEN -> FUNDED. */
  async fund(
    id: string,
    funderAddress: string,
    callerUserId: string,
  ): Promise<Bounty> {
    const bounty = await this.bountyRepo.findOne({
      where: { id },
      relations: { issue: true },
    });
    if (!bounty) throw new NotFoundException(`Bounty ${id} not found`);

    // Verify caller is the sponsor (or admin - admin role checked by guard)
    if (bounty.sponsorId !== callerUserId) {
      throw new ForbiddenException(
        'Only the bounty sponsor can fund this bounty',
      );
    }

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
  async claim(id: string, callerUserId: string): Promise<Bounty> {
    const bounty = await this.findOne(id);
    assertTransition(bounty.status, BountyStatus.CLAIMED);

    // The claimant is always the authenticated caller (#469); never a client-supplied id.
    const contributor = await this.userRepo.findOne({
      where: { id: callerUserId },
    });
    if (!contributor) {
      throw new BadRequestException(
        `Contributor ${callerUserId} does not correspond to a known user`,
      );
    }
    if (!contributor.stellarAddress) {
      throw new BadRequestException(
        `Contributor ${callerUserId} has no linked Stellar address`,
      );
    }

    bounty.claimedById = callerUserId;
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
   * The linked PR was merged on GitHub. Records MERGED, then releases the escrow
   * (single recipient or team split) and moves the bounty to PAID.
   *
   * The release and the PAID write share one transaction (#796), and the escrow
   * service writes its rows through that transaction. If the commit fails after
   * the on-chain release succeeded, the transaction hash is kept on the escrow for
   * reconciliation and the bounty stays MERGED. It is not marked RELEASE_FAILED,
   * because a retry would try to pay out again.
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

    const escrowId = bounty.escrowId;
    let releasedTxHash: string | null = null;

    try {
      const paid = await this.bountyRepo.manager.transaction(async (manager) => {
        const locked = await manager.findOne(Bounty, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked || locked.status !== BountyStatus.MERGED) {
          throw new InvalidBountyTransitionError(
            locked?.status ?? BountyStatus.OPEN,
            BountyStatus.PAID,
          );
        }

        if (locked.teamId) {
          const team = await this.teamRepo.findOne({
            where: { id: locked.teamId },
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
            const payments = await this.escrowService.splitRelease(
              escrowId,
              recipients,
              manager,
            );
            releasedTxHash = payments[0]?.txHash ?? null;
          }
        } else if (locked.claimedById) {
          const contributor = await this.userRepo.findOne({
            where: { id: locked.claimedById },
          });
          const escrow = await this.escrowService.release(
            escrowId,
            contributor?.stellarAddress ?? '',
            locked.claimedById,
            manager,
          );
          releasedTxHash = escrow.releaseTxHash ?? null;
        }

        locked.status = BountyStatus.PAID;
        locked.paidAt = new Date();
        return manager.save(Bounty, locked);
      });
      this.eventEmitter?.emit(ANALYTICS_PLATFORM_INVALIDATE_EVENT);
      return paid;
    } catch (err) {
      if (releasedTxHash) {
        // Funds already moved on-chain; only the local commit failed.
        this.logger.error(
          `Escrow ${escrowId} released on-chain (tx ${releasedTxHash}) but the local commit failed; reconcile manually`,
        );
        await this.bountyRepo.manager.update(
          Escrow,
          { id: escrowId },
          { releaseTxHash: releasedTxHash },
        );
        throw err;
      }
      // Nothing moved on-chain: record RELEASE_FAILED so the release can be retried.
      // The write is conditional on MERGED, so a concurrent change is not overwritten.
      await this.bountyRepo.update(
        { id, status: BountyStatus.MERGED },
        { status: BountyStatus.RELEASE_FAILED },
      );
      throw err;
    }
  }

  /** Sponsor (or admin/expiry job) reclaims escrowed funds. */
  /**
   * Refunds a bounty to its funder. Allowed for the bounty's sponsor and for
   * the maintainer of the repository the bounty's issue belongs to, e.g. to
   * unwind an abandoned bounty (#545). The route admits SPONSOR and
   * MAINTAINER, but a maintainer of some *other* repository is still
   * rejected. Safe to open up: escrow refunds always pay the original funder,
   * never the caller.
   *
   * The on-chain refund and the REFUNDED write share one transaction (#796).
   * A MERGED bounty cannot be refunded (#795).
   */
  async refund(id: string, callerUserId: string): Promise<Bounty> {
    const bounty = await this.bountyRepo.findOne({
      where: { id },
      relations: { issue: { repository: true } },
    });
    if (!bounty) throw new NotFoundException(`Bounty ${id} not found`);

    const isSponsor = bounty.sponsorId === callerUserId;
    const isRepoMaintainer =
      !!bounty.issue?.repository?.maintainerId &&
      bounty.issue.repository.maintainerId === callerUserId;
    if (!isSponsor && !isRepoMaintainer) {
      throw new ForbiddenException(
        "Only the bounty sponsor or the repository's maintainer can refund this bounty",
      );
    }

    assertTransition(bounty.status, BountyStatus.REFUNDED);

    if (!bounty.escrowId) {
      bounty.status = BountyStatus.REFUNDED;
      return this.bountyRepo.save(bounty);
    }

    const escrowId = bounty.escrowId;
    return this.bountyRepo.manager.transaction(async (manager) => {
      const locked = await manager.findOne(Bounty, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException(`Bounty ${id} not found`);
      assertTransition(locked.status, BountyStatus.REFUNDED);

      await this.escrowService.refund(escrowId, manager);
      locked.status = BountyStatus.REFUNDED;
      return manager.save(Bounty, locked);
    });
  }

  /**
   * Expires overdue bounties that were never merged, then returns escrowed funds.
   *
   * 1. Every expirable candidate moves to EXPIRED in one UPDATE, guarded by its
   *    status at query time (rows that may not move to EXPIRED are skipped and logged).
   * 2. Every EXPIRED bounty whose escrow is still LOCKED is refunded to its funder
   *    (#794). Each refund and its REFUNDED write share one transaction. If the
   *    refund fails, the bounty stays EXPIRED and the next sweep retries it, so
   *    funds cannot be stranded silently.
   *
   * Returns the number of rows step 1 changed.
   */
  async expireOverdue(): Promise<number> {
    const overdue = await this.bountyRepo
      .createQueryBuilder('bounty')
      .where('bounty.deadline IS NOT NULL AND bounty.deadline < :now', {
        now: new Date(),
      })
      .andWhere('bounty.status IN (:...statuses)', {
        statuses: EXPIRABLE_STATUSES,
      })
      .getMany();

    const expirableIds: string[] = [];
    for (const bounty of overdue) {
      try {
        assertTransition(bounty.status, BountyStatus.EXPIRED);
      } catch (err) {
        this.logger.warn(
          `Skipping expiry of bounty ${bounty.id}: ${(err as Error).message}`,
        );
        continue;
      }
      expirableIds.push(bounty.id);
    }

    let expired = 0;
    if (expirableIds.length > 0) {
      expired = await this.bountyRepo.manager.transaction(async (manager) => {
        const result = await manager
          .createQueryBuilder()
          .update(Bounty)
          .set({ status: BountyStatus.EXPIRED })
          .where('id IN (:...ids)', { ids: expirableIds })
          .andWhere('status IN (:...statuses)', {
            statuses: EXPIRABLE_STATUSES,
          })
          .execute();
        return result.affected ?? 0;
      });
    }

    const refunded = await this.refundStrandedEscrows();
    if (refunded > 0) {
      this.logger.log(`Refunded escrow for ${refunded} expired bounty(ies)`);
    }
    return expired;
  }

  /**
   * Refunds the escrow of every EXPIRED bounty whose escrow is still LOCKED.
   * Covers this sweep's expiries and retries earlier failures.
   */
  private async refundStrandedEscrows(): Promise<number> {
    const stranded = await this.bountyRepo
      .createQueryBuilder('bounty')
      .innerJoin('bounty.escrow', 'escrow')
      .select('bounty.id', 'id')
      .where('bounty.status = :expired', { expired: BountyStatus.EXPIRED })
      .andWhere('escrow.status = :locked', { locked: EscrowStatus.LOCKED })
      .getRawMany<{ id: string }>();

    let refunded = 0;
    for (const row of stranded) {
      if (await this.refundExpiredBounty(row.id)) refunded++;
    }
    return refunded;
  }

  /** Refunds one EXPIRED bounty's escrow and marks it REFUNDED. Returns false on failure. */
  private async refundExpiredBounty(id: string): Promise<boolean> {
    try {
      return await this.bountyRepo.manager.transaction(async (manager) => {
        const locked = await manager.findOne(Bounty, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked || locked.status !== BountyStatus.EXPIRED || !locked.escrowId) {
          return false;
        }
        await this.escrowService.refund(locked.escrowId, manager);
        assertTransition(locked.status, BountyStatus.REFUNDED);
        locked.status = BountyStatus.REFUNDED;
        await manager.save(Bounty, locked);
        return true;
      });
    } catch (err) {
      this.logger.error(
        `Could not refund escrow for expired bounty ${id}; the next sweep will retry: ${(err as Error).message}`,
      );
      return false;
    }
  }

  async list(options: ListBountiesOptions = {}): Promise<Bounty[]> {
    const qb = this.bountyRepo
      .createQueryBuilder('bounty')
      .leftJoinAndSelect('bounty.issue', 'issue')
      .leftJoinAndSelect('issue.repository', 'repository')
      .leftJoinAndSelect('bounty.claimedBy', 'claimedBy')
      .leftJoinAndSelect('bounty.team', 'team')
      .leftJoinAndSelect('team.splits', 'splits');

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

  /**
   * Not implemented yet (#253, #533). This used to resolve
   * `{ id, status: 'approved' }` without reading or writing anything, so the
   * route reported success for an approval that never happened. It now
   * answers 501 until the real approval flow exists.
   */
  approve(id: string): Promise<never> {
    return Promise.reject(
      new NotImplementedException(
        `Bounty approval is not implemented yet (bounty ${id})`,
      ),
    );
  }

  /** Not implemented yet (#253, #533) — see `approve`. */
  reject(id: string): Promise<never> {
    return Promise.reject(
      new NotImplementedException(
        `Bounty rejection is not implemented yet (bounty ${id})`,
      ),
    );
  }
}
