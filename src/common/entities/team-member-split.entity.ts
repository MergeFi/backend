import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Team } from './team.entity';
import { User } from './user.entity';

@Entity('team_member_splits')
export class TeamMemberSplit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Adding an index on teamId improves delete and join performance
  @Index()
  @Column({ type: 'uuid' })
  teamId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column('decimal', { precision: 5, scale: 2 })
  percentage: number;

  @ManyToOne(() => Team, (team) => team.splits, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teamId' })
  team: Team;

  @ManyToOne(() => User, (user) => user.teamSplits)
  @JoinColumn({ name: 'userId' })
  user: User;
}
