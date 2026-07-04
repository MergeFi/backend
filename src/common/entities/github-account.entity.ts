import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('github_accounts')
export class GithubAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  githubId: string;

  @Column()
  login: string;

  @Column({ nullable: true })
  profileUrl: string | null;

  @Column({ nullable: true })
  avatarUrl: string | null;

  /**
   * OAuth access token used for GitHub API calls made on the user's behalf.
   * TODO: encrypt at rest (e.g. KMS envelope encryption) before production use.
   * Never returned via API responses — excluded at the DTO/serialization layer.
   */
  @Column({ nullable: true, select: false })
  accessToken: string | null;

  @Column({ nullable: true, select: false })
  refreshToken: string | null;

  @OneToOne(() => User, (user) => user.githubAccount, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
