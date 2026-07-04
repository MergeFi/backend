import {
  Column,
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
  teamId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  /** Free-text label describing the member's contribution, e.g. "frontend". */
  @Column({ nullable: true })
  role: string | null;

  /** Percentage of the bounty payout, 0-100. Sum across a team must equal 100. */
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  percentage: string;

  @CreateDateColumn()
  createdAt: Date;
}
