import { Entity, Column, ManyToOne, JoinColumn, PrimaryGeneratedColumn, Index } from 'typeorm';
import { User } from './user.entity';

@Entity()
@Index(['userId', 'computedAt'])
export class ReputationSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @Column({ type: 'timestamp' })
  computedAt: Date;

  @Column({ type: 'int' })
  reputation: number;
}
