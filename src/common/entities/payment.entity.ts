import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Escrow } from './escrow.entity';
import { User } from './user.entity';
import { AssetType, PaymentStatus } from '../enums';

/** A single payout leg from an escrow release — one per recipient (team splits produce many). */
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // RESTRICT, not CASCADE: a Payment is a record of money that actually
  // moved. Deleting its parent Escrow must never silently delete that
  // payout record too — the database refuses the delete instead. See #27.
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
