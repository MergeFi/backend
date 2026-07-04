import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Issue } from './issue.entity';

@Entity('repositories')
@Index(['owner', 'name'], { unique: true })
export class Repository {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  githubRepoId: string;

  @Column()
  owner: string;

  @Column()
  name: string;

  @Column()
  fullName: string;

  @Column({ nullable: true, type: 'text' })
  description: string | null;

  @Column({ default: 'main' })
  defaultBranch: string;

  @Column({ default: false })
  private: boolean;

  @Column({ nullable: true })
  primaryLanguage: string | null;

  @Column({ default: 0 })
  stargazersCount: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  maintainer: User | null;

  @Column({ nullable: true })
  maintainerId: string | null;

  @OneToMany(() => Issue, (issue) => issue.repository)
  issues: Issue[];

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
