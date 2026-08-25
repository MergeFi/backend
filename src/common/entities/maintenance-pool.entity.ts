import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, JoinColumn } from 'typeorm';
import { MaintenancePoolStatus } from '../enums';
import { Escrow } from './escrow.entity';

@Entity('maintenance_pools')
export class MaintenancePool {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 10 })
  asset: string;

  @Column({ type: 'decimal', precision: 18, scale: 7, default: 0 })
  balance: string;

  @Column({ type: 'decimal', precision: 18, scale: 7, default: 0 })
  monthlyDeposit: string;

  @Column({ type: 'varchar', length: 56, nullable: true })
  sponsorAddress: string;

  @Column({ type: 'varchar', length: 56, nullable: true })
  maintainerAddress: string;

  @Column({ type: 'enum', enum: MaintenancePoolStatus, default: MaintenancePoolStatus.ACTIVE })
  status: MaintenancePoolStatus;

  @Column({ type: 'uuid', nullable: true })
  escrowId: string;

  @OneToMany(() => Escrow, (escrow) => escrow.maintenancePool)
  @JoinColumn({ name: 'id', referencedColumnName: 'maintenancePoolId' })
  escrows: Escrow[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
