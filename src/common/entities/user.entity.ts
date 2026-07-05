import {
  Column,
  CreateDateColumn,
  Entity,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../enums';
import { GithubAccount } from './github-account.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true, nullable: true })
  email: string | null;

  @Column({ unique: true })
  username: string;

  @Column({ type: 'varchar', nullable: true })
  displayName: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'simple-array', default: UserRole.CONTRIBUTOR })
  roles: UserRole[];

  /**
   * Stellar public key the user has linked to receive payouts / fund escrow.
   * Custody of the corresponding secret key always remains with the user
   * (their wallet, e.g. Freighter) — MergeFi never stores private keys for
   * end users, only for the platform treasury signer (see TREASURY_SECRET).
   */
  @Column({ type: 'varchar', nullable: true })
  stellarAddress: string | null;

  @OneToOne(() => GithubAccount, (account) => account.user, {
    cascade: true,
    nullable: true,
  })
  githubAccount: GithubAccount | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
