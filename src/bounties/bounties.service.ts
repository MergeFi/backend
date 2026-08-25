import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty } from '../common/entities/bounty.entity';
import { User } from '../common/entities/user.entity';
import { CreateBountyDto } from './dto/create-bounty.dto';
import { ClaimBountyDto } from './dto/claim-bounty.dto';
import { EscrowService } from '../escrow/escrow.service';
import { FundEscrowDto } from '../escrow/dto/fund-escrow.dto';
import { BountyStateMachine } from './bounty-state-machine';
import { BountyStatus } from '../common/enums';

@Injectable()
export class BountiesService {
  constructor(
    @InjectRepository(Bounty)
    private readonly bountyRepo: Repository<Bounty>,
    private readonly escrowService: EscrowService,
    private readonly stateMachine: BountyStateMachine,
  ) {}

  async create(createBountyDto: CreateBountyDto, user: User): Promise<Bounty> {
    const bounty = this.bountyRepo.create({
      ...createBountyDto,
      sponsorId: user.userId,
      status: BountyStatus.DRAFT,
    });
    return this.bountyRepo.save(bounty);
  }

  async findOne(id: string): Promise<Bounty> {
    const bounty = await this.bountyRepo.findOne({ where: { id } });
    if (!bounty) {
      throw new NotFoundException(`Bounty ${id} not found`);
    }
    return bounty;
  }

  async fund(id: string, user: User): Promise<Bounty> {
    const bounty = await this.findOne(id);
    
    // Authorization: only the sponsor can fund the bounty
    if (bounty.sponsorId !== user.userId) {
      throw new ForbiddenException('Only the bounty sponsor can fund this bounty');
    }

    if (bounty.status !== BountyStatus.DRAFT) {
      throw new BadRequestException(`Cannot fund bounty in status ${bounty.status}`);
    }

    const fundEscrowDto: FundEscrowDto = {
      amount: bounty.amount,
      token: bounty.token,
      bountyId: bounty.id,
      funderAddress: user.walletAddress, // Assuming user has walletAddress
    };

    const escrow = await this.escrowService.fund(fundEscrowDto, user);
    
    bounty.escrowId = escrow.id;
    bounty.status = BountyStatus.FUNDED;
    return this.bountyRepo.save(bounty);
  }

  async claim(id: string, claimBountyDto: ClaimBountyDto, user: User): Promise<Bounty> {
    const bounty = await this.findOne(id);

    // Authorization: only the claimant (contributor) can claim
    // The claimBountyDto.contributorId should match the authenticated user
    if (claimBountyDto.contributorId !== user.userId) {
      throw new ForbiddenException('You can only claim bounties for yourself');
    }

    this.stateMachine.validateTransition(bounty.status, BountyStatus.CLAIMED);
    bounty.status = BountyStatus.CLAIMED;
    bounty.claimantId = user.userId;
    return this.bountyRepo.save(bounty);
  }

  async refund(id: string, user: User): Promise<Bounty> {
    const bounty = await this.findOne(id);

    // Authorization: only the sponsor can refund
    if (bounty.sponsorId !== user.userId) {
      throw new ForbiddenException('Only the bounty sponsor can refund this bounty');
    }

    this.stateMachine.validateTransition(bounty.status, BountyStatus.REFUNDED);
    
    if (bounty.escrowId) {
      await this.escrowService.refund(bounty.escrowId, user);
    }

    bounty.status = BountyStatus.REFUNDED;
    return this.bountyRepo.save(bounty);
  }
}
