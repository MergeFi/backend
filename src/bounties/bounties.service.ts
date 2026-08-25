import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, In } from 'typeorm';
import { Bounty, BountyStatus } from '../common/entities/bounty.entity';
import { CreateBountyDto } from './dto/create-bounty.dto';
import { ClaimBountyDto } from './dto/claim-bounty.dto';
import { BountyStateMachine } from './bounty-state-machine';

interface PaginationOptions {
  limit?: number;
  offset?: number;
}

interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

@Injectable()
export class BountiesService {
  constructor(
    @InjectRepository(Bounty)
    private readonly bountyRepo: Repository<Bounty>,
    private readonly stateMachine: BountyStateMachine,
  ) {}

  async create(dto: CreateBountyDto, sponsorId: string): Promise<Bounty> {
    const bounty = this.bountyRepo.create({
      ...dto,
      sponsorId,
      status: BountyStatus.OPEN,
    });
    return this.bountyRepo.save(bounty);
  }

  async findOne(id: string): Promise<Bounty> {
    const bounty = await this.bountyRepo.findOne({ where: { id } });
    if (!bounty) {
      throw new NotFoundException(`Bounty with id ${id} not found`);
    }
    return bounty;
  }

  async list(status?: BountyStatus, pagination?: PaginationOptions): Promise<PaginatedResult<Bounty>> {
    const limit = Math.min(pagination?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = pagination?.offset ?? 0;

    const where: FindOptionsWhere<Bounty> = status ? { status } : {};

    const [data, total] = await this.bountyRepo.findAndCount({
      where,
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  async claim(id: string, dto: ClaimBountyDto, claimantId: string): Promise<Bounty> {
    const bounty = await this.findOne(id);
    this.stateMachine.claim(bounty, claimantId);
    return this.bountyRepo.save(bounty);
  }

  async submitWork(id: string, claimantId: string, prUrl: string): Promise<Bounty> {
    const bounty = await this.findOne(id);
    this.stateMachine.submitWork(bounty, claimantId, prUrl);
    return this.bountyRepo.save(bounty);
  }

  async approveWork(id: string, sponsorId: string): Promise<Bounty> {
    const bounty = await this.findOne(id);
    this.stateMachine.approveWork(bounty, sponsorId);
    return this.bountyRepo.save(bounty);
  }

  async rejectWork(id: string, sponsorId: string, reason: string): Promise<Bounty> {
    const bounty = await this.findOne(id);
    this.stateMachine.rejectWork(bounty, sponsorId, reason);
    return this.bountyRepo.save(bounty);
  }

  async cancel(id: string, sponsorId: string): Promise<Bounty> {
    const bounty = await this.findOne(id);
    this.stateMachine.cancel(bounty, sponsorId);
    return this.bountyRepo.save(bounty);
  }

  async getByIssueId(issueId: string): Promise<Bounty[]> {
    return this.bountyRepo.find({ where: { issueId } });
  }

  async getBySponsorId(sponsorId: string): Promise<Bounty[]> {
    return this.bountyRepo.find({ where: { sponsorId } });
  }

  async getByClaimantId(claimantId: string): Promise<Bounty[]> {
    return this.bountyRepo.find({ where: { claimantId } });
  }

  async getOpenBounties(): Promise<Bounty[]> {
    return this.bountyRepo.find({ where: { status: BountyStatus.OPEN } });
  }

  async getBountiesByStatuses(statuses: BountyStatus[]): Promise<Bounty[]> {
    return this.bountyRepo.find({ where: { status: In(statuses) } });
  }
}