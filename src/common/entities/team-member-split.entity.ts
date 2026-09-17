import {
  Column,
  Index,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Team } from './team.entity';
import { User } from './user.entity';

@Entity('team_member_splits')
export class TeamMemberSplit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Team, (team) => team.splits, { onDelete: 'CASCADE' })
  @JoinColumn()
  team: Team;

  @Column()
  @Index('IDX_team_member_splits_teamId')
  teamId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  /** Free-text label describing the member's contribution, e.g. "frontend". */
  @Column({ type: 'varchar', length: 50, nullable: true })
  role: string | null;

  /** Percentage of the bounty payout, 0-100. Sum across a team must equal 100. */
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  percentage: string;

  @CreateDateColumn()
  createdAt: Date;
}
