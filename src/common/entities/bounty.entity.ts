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

  @Column({ type: 'varchar', nullable: true })
  sponsorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  claimedBy: User | null;

  @Column({ type: 'varchar', nullable: true })
  claimedById: string | null;

  /** Set when the bounty payout is split across a team instead of one contributor. */
  @ManyToOne(() => Team, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  team: Team | null;

  @Column({ type: 'varchar', nullable: true })
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

  // cascade excludes 'remove'/'soft-remove': removing a Bounty entity via the
  // ORM must not also remove its Escrow — the escrow row (and the funds it
  // represents) must outlive the bounty record. See #27.
  @OneToOne(() => Escrow, (escrow) => escrow.bounty, {
    nullable: true,
    cascade: ['insert', 'update'],
  })
  escrow: Escrow | null;

  /**
   * Denormalized copy of escrow.id, set whenever `escrow` is assigned, so
   * services can check funding state without an extra join/relation load.
   */
  @Column({ type: 'varchar', nullable: true })
  escrowId: string | null;

  @Column({ type: 'varchar', nullable: true })
  prUrl: string | null;

  @Column({ type: 'int', nullable: true })
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
