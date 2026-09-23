import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Issue, MaintenancePool, Payment } from '../common/entities';
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
    @InjectRepository(Issue)
    private readonly issueRepo: Repository<Issue>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly escrowService: EscrowService,
  ) {}

  async create(dto: CreatePoolDto): Promise<MaintenancePool> {
    const pool = this.poolRepo.create({
      name: dto.name,
      repositoryId: dto.repositoryId ?? null,
      createdById: dto.createdById ?? null,
      monthlyDeposit: dto.monthlyDeposit,
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
    // Use SELECT ... FOR UPDATE to prevent concurrent first-time deposit races
    // that could orphan escrows (#275).
    const pool = await this.poolRepo
      .createQueryBuilder('pool')
      .setLock('pessimistic_write')
      .where('pool.id = :id', { id })
      .getOne();

    if (!pool) throw new NotFoundException(`Maintenance pool ${id} not found`);
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
      // Use WHERE escrowId IS NULL so a losing concurrent request detects the
      // race and tops up the winner's escrow instead of creating a second one.
      const updateResult = await this.poolRepo.update(
        { id: pool.id, escrowId: null } as any,
        { escrowId: escrow.id },
      );
      if (updateResult.affected === 0) {
        // Another request won the race — top up the winner's escrow instead.
        const existingPool = await this.findOne(id);
        await this.escrowService.fund({
          amount,
          asset: pool.asset,
          funderAddress,
          maintenancePoolId: pool.id,
        });
        await this.poolRepo.increment({ id }, 'balance', Number(amount));
        return this.findOne(id);
      }
    } else {
      // Subsequent deposits top up the existing on-chain escrow balance.
      await this.escrowService.fund({
        amount,
        asset: pool.asset,
        funderAddress,
        maintenancePoolId: pool.id,
      });
    }

    // Atomic DB-level increment instead of read-modify-write — concurrent
    // deposits/rewards on the same pool no longer clobber each other's
    // balance update (#51). monthlyDeposit is deliberately left untouched
    // here: it records the sponsor's standing recurring commitment (set at
    // pool creation), not "whatever the last deposit happened to be" (#93).
    await this.poolRepo.increment({ id: pool.id }, 'balance', Number(amount));

    return this.findOne(id);
  }

  /** Maintainer assigns a reward from the pool's balance for completed maintenance work. */
  async assignReward(
    id: string,
    issueId: string,
    amount: string,
    recipientAddress: string,
    recipientId?: string,
  ) {
    const pool = await this.findOne(id);
    const issue = await this.issueRepo.findOne({ where: { id: issueId } });
    if (!issue) throw new NotFoundException(`Issue ${issueId} not found`);
    if (!issue.isMaintenanceType) {
      throw new BadRequestException(
        `Issue ${issueId} is not eligible for maintenance-pool rewards`,
      );
    }
    if (pool.repositoryId && pool.repositoryId !== issue.repositoryId) {
      throw new BadRequestException(
        `Issue ${issueId} does not belong to pool ${id}'s repository`,
      );
    }
    if (!pool.escrowId) {
      throw new BadRequestException(`Pool ${id} has no funded escrow yet`);
    }

    // Guard against double/triple payout for the same issue (#273).
    const existingPayment = await this.paymentRepo.findOne({
      where: {
        recipientId: recipientId ?? null,
      },
    });
    // Check if there's already a payment for this issue from this pool's escrow.
    const existingPoolPayment = await this.paymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.escrow', 'escrow')
      .where('escrow.maintenancePoolId = :poolId', { poolId: id })
      .andWhere('payment.recipientId = :recipientId', {
        recipientId: recipientId ?? null,
      })
      .getOne();
    if (existingPoolPayment) {
      throw new ConflictException(
        `Issue ${issueId} has already received a reward from pool ${id}`,
      );
    }

    // Atomic balance check and decrement — prevents TOCTOU race where concurrent
    // calls could overdraw the pool (#274). Uses a conditional UPDATE that only
    // succeeds if balance >= amount, then checks affected rows.
    const updateResult = await this.poolRepo
      .createQueryBuilder()
      .update(MaintenancePool)
      .set({ balance: () => `balance - :amount` })
      .where('id = :id AND balance >= :amount', { id, amount: Number(amount) })
      .setParameter('amount', Number(amount))
      .execute();

    if (updateResult.affected === 0) {
      throw new BadRequestException(
        `Requested reward ${amount} exceeds pool balance ${pool.balance}`,
      );
    }

    // A maintenance pool is a running on-chain balance (deposit/withdraw),
    // not a milestone-style fixed lock that gets partially released and then
    // closed out — so pay the reward via the pool contract's `withdraw`,
    // leaving the escrow LOCKED for the next reward (#163).
    const payment = await this.escrowService.poolWithdraw(
      pool.escrowId,
      amount,
      recipientAddress,
      recipientId,
    );

    return payment;
  }

  async list(): Promise<MaintenancePool[]> {
    return this.poolRepo.find();
  }
}
