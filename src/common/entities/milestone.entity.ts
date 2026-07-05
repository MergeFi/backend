import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Repository } from './repository.entity';
import { User } from './user.entity';
import { Issue } from './issue.entity';
import { Escrow } from './escrow.entity';
import { AssetType, MilestoneStatus } from '../enums';

@Entity('milestones')
export class Milestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Repository, { onDelete: 'CASCADE' })
  @JoinColumn()
  repository: Repository;

  @Column()
  repositoryId: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  sponsor: User | null;

  @Column({ type: 'varchar', nullable: true })
  sponsorId: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  budget: string;

  /** Running total already distributed to resolved issues in this milestone. */
  @Column({ type: 'decimal', precision: 20, scale: 7, default: 0 })
  distributed: string;

  @Column({ type: 'enum', enum: AssetType, default: AssetType.USDC })
  asset: AssetType;

  @Column({
    type: 'enum',
    enum: MilestoneStatus,
    default: MilestoneStatus.OPEN,
  })
  status: MilestoneStatus;

  @Column({ type: 'timestamptz', nullable: true })
  deadline: Date | null;

  @OneToOne(() => Escrow, (escrow) => escrow.milestone, { nullable: true })
  escrow: Escrow | null;

  /** Denormalized copy of escrow.id, set whenever `escrow` is assigned. */
  @Column({ type: 'varchar', nullable: true })
  escrowId: string | null;

  @OneToMany(() => Issue, (issue) => issue.milestone)
  issues: Issue[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
