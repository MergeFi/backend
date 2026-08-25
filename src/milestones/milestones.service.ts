import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { Milestone } from '../common/entities/milestone.entity';

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
export class MilestonesService {
  constructor(
    @InjectRepository(Milestone)
    private readonly milestoneRepo: Repository<Milestone>,
  ) {}

  async create(data: Partial<Milestone>): Promise<Milestone> {
    const milestone = this.milestoneRepo.create(data);
    return this.milestoneRepo.save(milestone);
  }

  async findOne(id: string): Promise<Milestone> {
    const milestone = await this.milestoneRepo.findOne({ where: { id } });
    if (!milestone) {
      throw new NotFoundException(`Milestone with id ${id} not found`);
    }
    return milestone;
  }

  async list(pagination?: PaginationOptions): Promise<PaginatedResult<Milestone>> {
    const limit = Math.min(pagination?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = pagination?.offset ?? 0;

    const [data, total] = await this.milestoneRepo.findAndCount({
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

  async update(id: string, data: Partial<Milestone>): Promise<Milestone> {
    const milestone = await this.findOne(id);
    Object.assign(milestone, data);
    return this.milestoneRepo.save(milestone);
  }

  async delete(id: string): Promise<void> {
    const milestone = await this.findOne(id);
    await this.milestoneRepo.remove(milestone);
  }

  async getByRepositoryId(repositoryId: string): Promise<Milestone[]> {
    return this.milestoneRepo.find({ where: { repositoryId } });
  }

  async getBySponsorId(sponsorId: string): Promise<Milestone[]> {
    return this.milestoneRepo.find({ where: { sponsorId } });
  }
}