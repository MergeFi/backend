import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Repository } from './repository.entity';
import { Milestone } from './milestone.entity';
import { Bounty } from './bounty.entity';

@Entity('issues')
@Index(['repositoryId', 'number'], { unique: true })
export class Issue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Repository, (repo) => repo.issues, { onDelete: 'CASCADE' })
  @JoinColumn()
  repository: Repository;

  @Column()
  repositoryId: string;

  @Column({ unique: true })
  githubIssueId: string;

  @Column()
  number: number;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ default: 'open' })
  state: 'open' | 'closed';

  @Column({ type: 'simple-array', default: '' })
  labels: string[];

  @Column()
  githubUrl: string;

  @Column({ type: 'varchar', nullable: true })
  authorLogin: string | null;

  /** True for maintenance-type work (dep bumps, docs, cleanup) eligible for the pool. */
  @Column({ default: false })
  isMaintenanceType: boolean;

  @ManyToOne(() => Milestone, (milestone) => milestone.issues, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn()
  milestone: Milestone | null;

  @Column({ type: 'varchar', nullable: true })
  milestoneId: string | null;

  @OneToOne(() => Bounty, (bounty) => bounty.issue, { nullable: true })
  bounty: Bounty | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
