import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaintenancePool } from '../common/entities/maintenance-pool.entity';

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
export class MaintenancePoolService {
  constructor(
    @InjectRepository(MaintenancePool)
    private readonly poolRepo: Repository<MaintenancePool>,
  ) {}

  async create(data: Partial<MaintenancePool>): Promise<MaintenancePool> {
    const pool = this.poolRepo.create(data);
    return this.poolRepo.save(pool);
  }

  async findOne(id: string): Promise<MaintenancePool> {
    const pool = await this.poolRepo.findOne({ where: { id } });
    if (!pool) {
      throw new NotFoundException(`Maintenance pool with id ${id} not found`);
    }
    return pool;
  }

  async list(pagination?: PaginationOptions): Promise<PaginatedResult<MaintenancePool>> {
    const limit = Math.min(pagination?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = pagination?.offset ?? 0;

    const [data, total] = await this.poolRepo.findAndCount({
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

  async update(id: string, data: Partial<MaintenancePool>): Promise<MaintenancePool> {
    const pool = await this.findOne(id);
    Object.assign(pool, data);
    return this.poolRepo.save(pool);
  }

  async delete(id: string): Promise<void> {
    const pool = await this.findOne(id);
    await this.poolRepo.remove(pool);
  }

  async getByRepositoryId(repositoryId: string): Promise<MaintenancePool[]> {
    return this.poolRepo.find({ where: { repositoryId } });
  }

  async getBySponsorId(sponsorId: string): Promise<MaintenancePool[]> {
    return this.poolRepo.find({ where: { sponsorId } });
  }
}