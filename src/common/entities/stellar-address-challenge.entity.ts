import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * One server-issued ownership challenge for linking a Stellar address to a
 * user (#791). The client must sign `message` with the wallet for
 * `stellarAddress`; the PATCH then proves control of that key.
 *
 * Replay protection: `nonce` is unique, and a challenge is consumed by an
 * atomic `UPDATE ... WHERE consumedAt IS NULL`, so at most one PATCH can
 * claim it even under concurrent requests. Rows are stored in Postgres (not
 * process memory) so the check holds across replicas.
 */
@Entity('stellar_address_challenges')
export class StellarAddressChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  /** The G... address the challenge was issued for. */
  @Column({ type: 'varchar', length: 56 })
  stellarAddress: string;

  /** Server-generated, unguessable, single-use. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  nonce: string;

  /** Exact text the wallet signs. Stored so verification never rebuilds it. */
  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Set when the challenge is redeemed. Non-null means it cannot be reused. */
  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
