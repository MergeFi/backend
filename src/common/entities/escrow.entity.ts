import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { EscrowStatus } from '../enums';
import { MaintenancePool } from './maintenance-pool.entity';

@Entity('escrows')
@Index(['maintenancePoolId'])
export class Escrow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  asset: string;

  @Column({ type: 'decimal', precision: 18, scale: 7 })
  amount: string;

  @Column({ type: 'decimal', precision: 18, scale: 7, default: 0 })
  releasedAmount: string;

  @Column({ type: 'enum', enum: EscrowStatus, default: EscrowStatus.LOCKED })
  status: EscrowStatus;

  @Column({ type: 'varchar', length: 56 })
  funderAddress: string;

  @Column({ type: 'varchar', length: 56, nullable: true })
  recipientAddress: string;

  @Column({ type: 'uuid', nullable: true })
  maintenancePoolId: string;

  @ManyToOne(() => MaintenancePool, (pool) => pool.escrows, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'maintenancePoolId' })
  maintenancePool: MaintenancePool;

  @Column({ type: 'varchar', length: 66, nullable: true })
  contractId: string;

  @Column({ type: 'varchar', length: 66, nullable: true })
  transactionHash: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  get availableAmount(): string {
    return (Number(this.amount) - Number(this.releasedAmount)).toFixed(7);
  }
}
