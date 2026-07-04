import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Point-in-time computed reputation stats for a contributor. Recomputed
 * periodically (or on-demand) by ReputationService and appended here so
 * changes over time can be charted; the "current" stats are simply the
 * most recent snapshot per user.
 */
@Entity('reputation_snapshots')
export class ReputationSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @Column({ type: 'decimal', precision: 20, scale: 7, default: 0 })
  totalEarnings: string;

  @Column({ default: 0 })
  mergedPrCount: number;

  @Column({ default: 0 })
  openBountiesClaimed: number;

  /** Percentage of claimed bounties that were eventually merged & paid. */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  completionRate: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  avgReviewTimeHours: string;

  /** Percentage of merged bounties paid before their deadline. */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  onTimeDeliveryPercentage: string;

  @Column({ type: 'jsonb', nullable: true })
  languages: Record<string, number> | null;

  @Column({ type: 'simple-array', default: '' })
  orgsContributedTo: string[];

  @CreateDateColumn()
  computedAt: Date;
}
