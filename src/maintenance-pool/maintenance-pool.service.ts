import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaintenancePool } from '../common/entities';
import { MaintenancePoolStatus } from '../common/enums';
import { EscrowService } from '../escrow/escrow.service';
import { CreatePoolDto } from './dto/create-pool.dto';

/**
 * Recurring maintenance pool: sponsors make monthly deposits into a shared
 * escrow; maintainers assign rewards out of the running balance for
 * maintenance-type work (dependency bumps, docs, cleanup) without needing to
 * create a one-off bounty + individual escrow each time.
 */
@Injectable()
export class MaintenancePoolService {
  constructor(
    @InjectRepository(MaintenancePool)
    private readonly poolRepo: Repository<MaintenancePool>,
    private readonly escrowService: EscrowService,
  ) {}

  async create(dto: CreatePoolDto): Promise<MaintenancePool> {
    const pool = this.poolRepo.create({
      name: dto.name,
      repositoryId: dto.repositoryId ?? null,
      createdById: dto.createdById ?? null,
      asset: dto.asset,
      status: MaintenancePoolStatus.ACTIVE,
    });
    return this.poolRepo.save(pool);
  }

  async findOne(id: string): Promise<MaintenancePool> {
    const pool = await this.poolRepo.findOne({ where: { id } });
    if (!pool) throw new NotFoundException(`Maintenance pool ${id} not found`);
    return pool;
  }

  /** Sponsor makes a (typically monthly) deposit, topping up the pool's on-chain balance. */
  async deposit(
    id: string,
    amount: string,
    funderAddress: string,
  ): Promise<MaintenancePool> {
    const pool = await this.findOne(id);
    if (pool.status !== MaintenancePoolStatus.ACTIVE) {
      throw new BadRequestException(`Pool ${id} is not ACTIVE`);
    }

    if (!pool.escrowId) {
      const escrow = await this.escrowService.fund({
        amount,
        asset: pool.asset,
        funderAddress,
        maintenancePoolId: pool.id,
      });
      pool.escrow = escrow;
      pool.escrowId = escrow.id;
    } else {
      // Subsequent deposits top up the existing on-chain escrow balance.
      await this.escrowService.fund({
        amount,
        asset: pool.asset,
        funderAddress,
        maintenancePoolId: pool.id,
      });
    }

    pool.balance = (Number(pool.balance) + Number(amount)).toFixed(7);
    pool.monthlyDeposit = amount;
    return this.poolRepo.save(pool);
  }

  /** Maintainer assigns a reward from the pool's balance for completed maintenance work. */
  async assignReward(
    id: string,
    amount: string,
    recipientAddress: string,
    recipientId?: string,
  ) {
    const pool = await this.findOne(id);
    if (!pool.escrowId) {
      throw new BadRequestException(`Pool ${id} has no funded escrow yet`);
    }
    if (Number(amount) > Number(pool.balance)) {
      throw new BadRequestException(
        `Requested reward ${amount} exceeds pool balance ${pool.balance}`,
      );
    }

    const payment = await this.escrowService.releasePartial(
      pool.escrowId,
      amount,
      recipientAddress,
      recipientId,
    );

    pool.balance = (Number(pool.balance) - Number(amount)).toFixed(7);
    await this.poolRepo.save(pool);

    return payment;
  }

  async list(): Promise<MaintenancePool[]> {
    return this.poolRepo.find();
  }
}
