import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Bounty } from './bounty.entity';
import { Milestone } from './milestone.entity';
import { MaintenancePool } from './maintenance-pool.entity';
import { Payment } from './payment.entity';
import { AssetType, EscrowStatus } from '../enums';

/**
 * Local ledger of an on-chain Soroban escrow contract invocation. One row per
 * "escrow instance" — a bounty, a milestone pool, or a maintenance pool.
 * The actual funds custody lives in the deployed escrow contract on Stellar;
 * this table mirrors state so the API can serve fast reads and so we have an
 * audit trail independent of Horizon/RPC availability.
 */
@Entity('escrows')
export class Escrow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Bounty, (bounty) => bounty.escrow, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  bounty: Bounty | null;

  @Column({ type: 'varchar', nullable: true })
  bountyId: string | null;

  @OneToOne(() => Milestone, (milestone) => milestone.escrow, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  milestone: Milestone | null;

  @Column({ type: 'varchar', nullable: true })
  milestoneId: string | null;

  @OneToOne(() => MaintenancePool, (pool) => pool.escrow, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  maintenancePool: MaintenancePool | null;

  @Column({ type: 'varchar', nullable: true })
  maintenancePoolId: string | null;

  /** Deployed Soroban contract ID this escrow instance is held by. */
  @Column({ type: 'varchar', nullable: true })
  contractId: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  amount: string;

  @Column({ type: 'enum', enum: AssetType, default: AssetType.USDC })
  asset: AssetType;

  @Column({ type: 'enum', enum: EscrowStatus, default: EscrowStatus.PENDING })
  status: EscrowStatus;

  @Column({ type: 'varchar', nullable: true })
  fundedByAddress: string | null;

  /** Stellar transaction hash of the fund/lock invocation. */
  @Column({ type: 'varchar', nullable: true })
  fundTxHash: string | null;

  /** Stellar transaction hash of the release invocation (final release event). */
  @Column({ type: 'varchar', nullable: true })
  releaseTxHash: string | null;

  /** Stellar transaction hash of the refund invocation, if refunded. */
  @Column({ type: 'varchar', nullable: true })
  refundTxHash: string | null;

  /** Arbitrary metadata returned from the Soroban RPC call (sim results, ledger, etc). */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @OneToMany(() => Payment, (payment) => payment.escrow)
  payments: Payment[];

  @Column({ type: 'timestamptz', nullable: true })
  lockedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
