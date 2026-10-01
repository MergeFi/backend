import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async create(
    dto: CreatePoolDto,
    callerUserId: string,
  ): Promise<MaintenancePool> {
    const pool = this.poolRepo.create({
      name: dto.name?.trim() ?? dto.name,
      repositoryId: dto.repositoryId ?? null,
      createdById: dto.createdById ?? callerUserId,
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

  /**
   * Fix #457: wrap in dataSource.transaction() so the pessimistic_write lock
   * has an active QueryRunner.
   */
  async deposit(
    id: string,
    amount: string,
    funderAddress: string,
  ): Promise<MaintenancePool> {
    return this.dataSource.transaction(async (manager) => {
      const pool = await manager
        .createQueryBuilder(MaintenancePool, 'pool')
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
        const updateResult = await manager.update(
          MaintenancePool,
          { id: pool.id, escrowId: null } as any,
          { escrowId: escrow.id },
        );
        if (updateResult.affected === 0) {
          await this.escrowService.fund({
            amount,
            asset: pool.asset,
            funderAddress,
            maintenancePoolId: pool.id,
          });
          await manager.increment(MaintenancePool, { id }, 'balance', Number(amount));
          return manager.findOneByOrFail(MaintenancePool, { id });
        }
      } else {
        await this.escrowService.fund({
          amount,
          asset: pool.asset,
          funderAddress,
          maintenancePoolId: pool.id,
        });
      }

      await manager.increment(MaintenancePool, { id: pool.id }, 'balance', Number(amount));
      return manager.findOneByOrFail(MaintenancePool, { id: pool.id });
    });
  }

  /**
   * Maintainer assigns a reward from the pool's balance for completed
   * maintenance work.
   *
   * Fix #458: the previous double-payout guard was keyed on
   * (escrow.maintenancePoolId, recipientId), not (escrow.maintenancePoolId,
   * issueId). The same issue could be paid twice to two different recipients,
   * and anonymous payouts (recipientId=null) were never guarded at all.
   *
   * The guard now filters on (escrow.maintenancePoolId, payment.issueId) so
   * each issue can only receive one reward per pool regardless of recipient.
   * payment.issueId is a new nullable column added to the Payment entity (#458).
   */
  async assignReward(
    id: string,
    issueId: string,
    amount: string,
    recipientAddress: string,
    recipientId?: string,
  ) {
    const pool = await this.findOne(id);
    if (pool.status !== MaintenancePoolStatus.ACTIVE) {
      throw new BadRequestException(`Pool ${id} is not ACTIVE`);
    }
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

    // Guard against double/triple payout for the same issue (#273, #458).
    // Key: (escrow.maintenancePoolId, payment.issueId) -- covers all recipients
    // including anonymous (recipientId=null) ones.
    const existingIssuePayment = await this.paymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.escrow', 'escrow')
      .where('escrow.maintenancePoolId = :poolId', { poolId: id })
      .andWhere('payment.issueId = :issueId', { issueId })
      .getOne();
    if (existingIssuePayment) {
      throw new ConflictException(
        `Issue ${issueId} has already received a reward from pool ${id}`,
      );
    }

    // Atomic balance check and decrement (#274).
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

    const payment = await this.escrowService.poolWithdraw(
      pool.escrowId,
      amount,
      recipientAddress,
      recipientId,
      issueId,
    );

    return payment;
  }

  async list(): Promise<MaintenancePool[]> {
    return this.poolRepo.find();
  }
}
