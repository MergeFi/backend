import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Team } from './team.entity';
import { User } from './user.entity';

@Entity('team_member_splits')
@Check(
  'CHK_team_member_split_percentage_range',
  '"percentage" >= 0 AND "percentage" <= 100',
)
export class TeamMemberSplit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Team, (team) => team.splits, { onDelete: 'CASCADE' })
  @JoinColumn()
  team: Team;

  @Column()
  @Index()
  teamId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  user: User | null;

  @Column({ type: 'varchar', nullable: true })
  userId: string | null;

  /** Free-text label describing the member's contribution, e.g. "frontend". */
  @Column({ type: 'varchar', length: 50, nullable: true })
  role: string | null;

  /** Percentage of the bounty payout, 0-100. Sum across a team must equal 100. */
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  percentage: string;

  @CreateDateColumn()
  createdAt: Date;
}
