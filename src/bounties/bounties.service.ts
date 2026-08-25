import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Bounty } from '../common/entities/bounty.entity';
import { BountyStatus } from '../common/enums';
import { assertTransition, InvalidBountyTransitionError } from './bounty-state-machine';
import { EscrowService } from '../escrow/escrow.service';
import { TeamService } from '../teams/teams.service';

@Injectable()
export class BountiesService {
  constructor(
    @Inject('BOUNTY_REPOSITORY')
    private readonly bountyRepo: Repository<Bounty>,
    private readonly escrowService: EscrowService,
    private readonly teamService: TeamService,
  ) {}

  async findOne(id: string): Promise<Bounty> {
    const bounty = await this.bountyRepo.findOne({
      where: { id },
      relations: ['claimedBy', 'team', 'team.members', 'escrow'],
    });
    if (!bounty) throw new NotFoundException(`Bounty ${id} not found`);
    return bounty;
  }

  async markMergedAndRelease(id: string): Promise<Bounty> {
    const bounty = await this.findOne(id);

    // If already MERGED, skip the transition to MERGED and proceed directly to release attempt.
    // This makes the method idempotent for the release step, allowing retry after a transient failure.
    const isAlreadyMerged = bounty.status === BountyStatus.MERGED;

    if (!isAlreadyMerged) {
      assertTransition(bounty.status, BountyStatus.MERGED);

      bounty.status = BountyStatus.MERGED;
      bounty.mergedAt = new Date();
      await this.bountyRepo.save(bounty);
    }

    if (!bounty.escrowId) return bounty;

    if (bounty.teamId) {
      const team = await this.teamService.findOne(bounty.teamId);
      const recipients = team.members.map((m) => ({
        address: m.user.stellarAddress,
        shareBps: m.shareBps,
      }));
      await this.escrowService.splitRelease(bounty.escrowId, recipients);
    } else if (bounty.claimedById) {
      await this.escrowService.release(bounty.escrowId, bounty.claimedBy.stellarAddress);
    }

    assertTransition(bounty.status, BountyStatus.PAID);
    bounty.status = BountyStatus.PAID;
    bounty.paidAt = new Date();
    await this.bountyRepo.save(bounty);

    return bounty;
  }

  async refund(id: string): Promise<Bounty> {
    const bounty = await this.findOne(id);
    assertTransition(bounty.status, BountyStatus.REFUNDED);
    if (bounty.escrowId) await this.escrowService.refund(bounty.escrowId);
    bounty.status = BountyStatus.REFUNDED;
    bounty.refundedAt = new Date();
    await this.bountyRepo.save(bounty);
    return bounty;
  }

  // ... other methods (create, claim, etc.)
}
