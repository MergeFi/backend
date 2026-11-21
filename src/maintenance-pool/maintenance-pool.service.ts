import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Escrow,
  Issue,
  MaintenancePool,
  Payment,
  User,
} from '../common/entities';
import { MaintenancePoolStatus } from '../common/enums';
import { amountToStroops } from '../common/validators/money.validator';
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
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Escrow)
    private readonly escrowRepo: Repository<Escrow>,
    private readonly escrowService: EscrowService,
  ) {}

  async create(
    dto: CreatePoolDto,
    callerUserId: string,
  ): Promise<MaintenancePool> {
    const pool = this.poolRepo.create({
      name: dto.name?.trim() ?? dto.name,
      repositoryId: dto.repositoryId ?? null,
      // createdById is bound strictly to the authenticated caller (#852).
      createdById: callerUserId,
      monthlyDeposit: dto.monthlyDeposit,
      asset: dto.asset,
      status: MaintenancePoolStatus.ACTIVE,
    });
    return this.poolRepo.save(pool);
  }

  async findOne(id: string): Promise<MaintenancePool> {
    const pool = await this.poolRepo.findOne({
      where: { id },
      relations: { repository: true },
    });
    if (!pool) throw new NotFoundException(`Maintenance pool ${id} not found`);
    return pool;
  }

  /**
   * Sponsor makes a (typically monthly) deposit, topping up the pool's on-chain balance.
   *
   * Authorization (#798): only the pool's creator (`createdById`, the sole
   * ownership field on MaintenancePool; there is no maintainer relation) may
   * fund it, and `funderAddress` must be the caller's own linked
   * `stellarAddress`. The depositing user is recorded on each escrow row.
   */
  async deposit(
    id: string,
    amount: string,
    funderAddress: string,
    callerUserId: string,
  ): Promise<MaintenancePool> {
    // Refuse before touching the DB when no pool contract is configured (#754).
    // The fallback to ESCROW_CONTRACT_ID was removed: the two contracts have
    // disjoint interfaces and routing a deposit to the bounty escrow would lock
    // funds under a key nothing else will ever look up.
    if (!this.escrowService.isPoolConfigured()) {
      throw new BadRequestException(
        'MAINTENANCE_POOL_CONTRACT_ID is not configured — pool deposits are disabled until the contract is deployed and the variable is set',
      );
    }

    // Use SELECT ... FOR UPDATE to prevent concurrent first-time deposit races
    // that could orphan escrows (#275).
    const pool = await this.poolRepo
      .createQueryBuilder('pool')
      .setLock('pessimistic_write')
      .where('pool.id = :id', { id })
      .getOne();

    if (!pool) throw new NotFoundException(`Maintenance pool ${id} not found`);
    // A null createdById never equals a caller id, so legacy ownerless pools are closed.
    if (pool.createdById !== callerUserId) {
      throw new ForbiddenException(
        'Only the maintenance pool creator can fund this pool',
      );
    }
    await this.assertFunderIsCaller(funderAddress, callerUserId);
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
      await this.recordDepositor(escrow, callerUserId);
      // Use WHERE escrowId IS NULL so a losing concurrent request detects the
      // race and tops up the winner's escrow instead of creating a second one.
      const updateResult = await this.poolRepo.update(
        { id: pool.id, escrowId: null } as any,
        { escrowId: escrow.id },
      );
      if (updateResult.affected === 0) {
        // Another request won the race — deposit into the winner's escrow instead of creating a second one (#781).
        const existingPool = await this.findOne(id);
        if (!existingPool.escrowId) {
          throw new Error(`Pool ${id} lost the escrow race but has no escrowId`);
        }
        const topUp = await this.escrowService.depositToPool(existingPool.escrowId, {
          amount,
          asset: pool.asset,
          funderAddress,
        });
        await this.recordDepositor(topUp, callerUserId);
        await this.creditPoolBalance(id, amount);
        return this.findOne(id);
      }
    } else {
      // Subsequent deposits top up the existing pool escrow. No new escrow row is created (#781).
      const topUp = await this.escrowService.depositToPool(pool.escrowId, {
        amount,
        asset: pool.asset,
        funderAddress,
      });
      await this.recordDepositor(topUp, callerUserId);
    }

    // Atomic DB-level update instead of read-modify-write — concurrent
    // deposits/rewards on the same pool no longer clobber each other's
    // balance update (#51). monthlyDeposit is deliberately left untouched
    // here: it records the sponsor's standing recurring commitment (set at
    // pool creation), not "whatever the last deposit happened to be" (#93).
    await this.creditPoolBalance(pool.id, amount);

    return this.findOne(id);
  }

  /**
   * Adds `amount` to the pool balance with exact NUMERIC arithmetic (#780).
   * The amount stays a decimal string end to end: converting it with Number()
   * would round 7-decimal money to a double. amountToStroops validates it and
   * throws on malformed input before anything is written.
   */
  private async creditPoolBalance(id: string, amount: string): Promise<void> {
    amountToStroops(amount);
    await this.poolRepo.query(
      'UPDATE maintenance_pools SET balance = balance + CAST($1 AS numeric), "updatedAt" = now() WHERE id = $2',
      [amount, id],
    );
  }

  /**
   * The funder address must be the caller's own verified Stellar address, so
   * a deposit cannot be attributed to a wallet the caller does not control.
   * Note: `stellarAddress` has no separate verified flag in the users module;
   * it is the only linked-address field available.
   */
  private async assertFunderIsCaller(
    funderAddress: string,
    callerUserId: string,
  ): Promise<void> {
    const caller = await this.userRepo.findOne({
      where: { id: callerUserId },
    });
    if (!caller?.stellarAddress || caller.stellarAddress !== funderAddress) {
      throw new ForbiddenException(
        'funderAddress must be the stellarAddress linked to your account',
      );
    }
  }

  private async recordDepositor(
    escrow: Escrow,
    callerUserId: string,
  ): Promise<void> {
    escrow.depositedById = callerUserId;
    await this.escrowRepo.save(escrow);
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
    // succeeds if balance >= amount, then checks affected rows. Compared and
    // subtracted as NUMERIC in SQL, never as a JS float (#780).
    const updateResult = await this.poolRepo
      .createQueryBuilder()
      .update(MaintenancePool)
      .set({ balance: () => 'balance - CAST(:amount AS numeric)' })
      .where('id = :id AND balance >= CAST(:amount AS numeric)', { id, amount })
      .setParameter('amount', amount)
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
    return this.poolRepo.find({
      relations: { repository: true },
    });
  }
}
