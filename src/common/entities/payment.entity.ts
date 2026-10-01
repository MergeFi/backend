import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Escrow } from './escrow.entity';
import { User } from './user.entity';
import { AssetType, PaymentStatus } from '../enums';

/**
 * A single payout leg from an escrow release -- one per recipient (team splits
 * produce many).
 *
 * `IDX_payment_escrow` serves `WHERE escrowId = :escrowId`, the lookup
 * `EscrowService.releasePartial` runs on every call to compute the
 * cumulative released-so-far balance before allowing a further partial
 * payout -- a hot path on every milestone-driven incremental release
 * (#307). The same gap class as `IDX_escrow_sponsor_status` (#97) and the
 * `Bounty.claimedById` index (#148).
 *
 * `issueId` (nullable) is set by `MaintenancePoolService.assignReward` so
 * that the double-payout guard (#458) can be keyed on (pool, issue) rather
 * than (pool, recipient) -- preventing the same issue being rewarded twice
 * regardless of who the recipient is.
 */
@Entity('payments')
@Index('IDX_payment_escrow', ['escrowId'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // RESTRICT, not CASCADE: a Payment is a record of money that actually
  // moved. Deleting its parent Escrow must never silently delete that
  // payout record too -- the database refuses the delete instead. See #27.
  @ManyToOne(() => Escrow, (escrow) => escrow.payments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn()
  escrow: Escrow;

  @Column()
  escrowId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  recipient: User | null;

  @Column({ type: 'varchar', nullable: true })
  recipientId: string | null;

  @Column({ type: 'varchar', nullable: true })
  recipientAddress: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  amount: string;

  @Column({ type: 'enum', enum: AssetType, default: AssetType.USDC })
  asset: AssetType;

  /** Percentage of the parent escrow this payment represents (team splits). */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  splitPercentage: string | null;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  @Column({ type: 'varchar', nullable: true })
  txHash: string | null;

  /**
   * Issue ID that triggered this maintenance-pool reward. Null for bounty/
   * milestone payments. Set by MaintenancePoolService.assignReward() so the
   * double-payout guard can query (escrow.maintenancePoolId, issueId) instead
   * of (escrow.maintenancePoolId, recipientId), closing the gap reported in
   * #458 where the same issue could be paid twice to different recipients.
   */
  @Column({ type: 'varchar', nullable: true })
  issueId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
