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
import { Issue } from './issue.entity';
import { User } from './user.entity';
import { Team } from './team.entity';
import { Escrow } from './escrow.entity';
import { AssetType, BountyDifficulty, BountyStatus } from '../enums';

@Entity('bounties')
export class Bounty {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Issue, (issue) => issue.bounty, { onDelete: 'CASCADE' })
  @JoinColumn()
  issue: Issue;

  @Column()
  issueId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  sponsor: User | null;

  @Column({ nullable: true })
  sponsorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  claimedBy: User | null;

  @Column({ nullable: true })
  claimedById: string | null;

  /** Set when the bounty payout is split across a team instead of one contributor. */
  @ManyToOne(() => Team, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  team: Team | null;

  @Column({ nullable: true })
  teamId: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  amount: string;

  @Column({ type: 'enum', enum: AssetType, default: AssetType.USDC })
  asset: AssetType;

  @Column({
    type: 'enum',
    enum: BountyDifficulty,
    default: BountyDifficulty.INTERMEDIATE,
  })
  difficulty: BountyDifficulty;

  @Column({ type: 'enum', enum: BountyStatus, default: BountyStatus.OPEN })
  status: BountyStatus;

  @Column({ type: 'timestamptz', nullable: true })
  deadline: Date | null;

  @OneToOne(() => Escrow, (escrow) => escrow.bounty, {
    nullable: true,
    cascade: true,
  })
  escrow: Escrow | null;

  /**
   * Denormalized copy of escrow.id, set whenever `escrow` is assigned, so
   * services can check funding state without an extra join/relation load.
   */
  @Column({ nullable: true })
  escrowId: string | null;

  @Column({ nullable: true })
  prUrl: string | null;

  @Column({ nullable: true })
  prNumber: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  claimedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  mergedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
