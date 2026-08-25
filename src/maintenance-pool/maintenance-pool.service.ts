import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaintenancePool } from '../common/entities/maintenance-pool.entity';
import { MaintenancePoolStatus } from '../common/enums';
import { EscrowService } from '../escrow/escrow.service';

@Injectable()
export class MaintenancePoolService {
  constructor(
    @InjectRepository(MaintenancePool)
    private readonly poolRepo: Repository<MaintenancePool>,
    private readonly escrowService: EscrowService,
  ) {}

  async create(data: Partial<MaintenancePool>): Promise<MaintenancePool> {
    const pool = this.poolRepo.create(data);
    return this.poolRepo.save(pool);
  }

  async findAll(): Promise<MaintenancePool[]> {
    return this.poolRepo.find({ relations: ['escrows'] });
  }

  async findOne(id: string): Promise<MaintenancePool> {
    const pool = await this.poolRepo.findOne({ where: { id }, relations: ['escrows'] });
    if (!pool) throw new NotFoundException(`MaintenancePool ${id} not found`);
    return pool;
  }

  async deposit(id: string, amount: string, funderAddress: string): Promise<MaintenancePool> {
    const pool = await this.findOne(id);
    if (pool.status !== MaintenancePoolStatus.ACTIVE) {
      throw new BadRequestException(`Pool ${id} is not ACTIVE`);
    }

    const escrow = await this.escrowService.fund({ amount, asset: pool.asset, funderAddress, maintenancePoolId: pool.id });
    
    // Update pool's escrowId to point to the latest escrow for backward compatibility
    pool.escrowId = escrow.id;
    pool.balance = (Number(pool.balance) + Number(amount)).toFixed(7);
    pool.monthlyDeposit = amount;
    return this.poolRepo.save(pool);
  }

  async assignReward(id: string, amount: string, recipientAddress: string, recipientId?: string) {
    const pool = await this.findOne(id);
    if (!pool.escrows || pool.escrows.length === 0) {
      throw new BadRequestException(`Pool ${id} has no funded escrow yet`);
    }
    if (Number(amount) > Number(pool.balance)) {
      throw new BadRequestException(`Requested reward ${amount} exceeds pool balance ${pool.balance}`);
    }

    const payments = await this.escrowService.releasePartialFromPool(pool.id, amount, recipientAddress, recipientId);
    
    pool.balance = (Number(pool.balance) - Number(amount)).toFixed(7);
    await this.poolRepo.save(pool);

    return { pool, payments };
  }

  async updateStatus(id: string, status: MaintenancePoolStatus): Promise<MaintenancePool> {
    const pool = await this.findOne(id);
    pool.status = status;
    return this.poolRepo.save(pool);
  }

  async getTotalReleasableBalance(poolId: string): Promise<string> {
    const escrows = await this.escrowService.findLockedByMaintenancePool(poolId);
    const total = escrows.reduce((sum, e) => sum + Number(e.amount) - Number(e.releasedAmount), 0);
    return total.toFixed(7);
  }
}
