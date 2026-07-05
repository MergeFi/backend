import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Repository } from './repository.entity';
import { User } from './user.entity';
import { Escrow } from './escrow.entity';
import { AssetType, MaintenancePoolStatus } from '../enums';

@Entity('maintenance_pools')
export class MaintenancePool {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ManyToOne(() => Repository, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn()
  repository: Repository | null;

  @Column({ type: 'varchar', nullable: true })
  repositoryId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  createdBy: User | null;

  @Column({ type: 'varchar', nullable: true })
  createdById: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 7, default: 0 })
  monthlyDeposit: string;

  /** Current spendable balance held in the pool's escrow contract. */
  @Column({ type: 'decimal', precision: 20, scale: 7, default: 0 })
  balance: string;

  @Column({ type: 'enum', enum: AssetType, default: AssetType.USDC })
  asset: AssetType;

  @Column({
    type: 'enum',
    enum: MaintenancePoolStatus,
    default: MaintenancePoolStatus.ACTIVE,
  })
  status: MaintenancePoolStatus;

  @OneToOne(() => Escrow, (escrow) => escrow.maintenancePool, {
    nullable: true,
  })
  escrow: Escrow | null;

  /** Denormalized copy of escrow.id, set whenever `escrow` is assigned. */
  @Column({ type: 'varchar', nullable: true })
  escrowId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
