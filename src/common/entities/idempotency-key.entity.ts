import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IdempotencyKeyStatus } from '../enums';

/**
 * Shape jsonb can actually hold — narrower than `unknown` so TypeORM's
 * update()/insert() typings resolve cleanly. Deliberately not a fully
 * recursive JSON type (nested values are `unknown`, not `JsonValue`) —
 * combining self-referential types with TypeORM's own recursive
 * QueryDeepPartialEntity<T> mapped type blows past TS's instantiation
 * depth limit ("Type instantiation is excessively deep").
 */
export type JsonValue =
  Record<string, unknown> | unknown[] | string | number | boolean | null;

/**
 * One row per (Idempotency-Key header value, endpoint scope, caller) tuple
 * seen on an idempotency-guarded mutation endpoint (#16).
 *
 * The unique index below is the actual concurrency-safety mechanism: two
 * simultaneous requests carrying the same key/scope/caller both attempt an
 * INSERT, the database allows exactly one to succeed, and the loser reads
 * back the winner's row instead of racing into a second execution of the
 * underlying mutation. This is why `IdempotencyInterceptor` uses a plain
 * `repo.insert(...)` wrapped in a try/catch for the unique-violation error,
 * rather than a "check then insert" — the DB constraint is what actually
 * closes the TOCTOU gap; a JS-level check-then-act would just relocate it.
 */
@Entity('idempotency_keys')
@Index(['key', 'scope', 'callerId'], { unique: true })
export class IdempotencyKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The raw Idempotency-Key header value the client supplied. */
  @Column()
  key: string;

  /** Which endpoint this key applies to, e.g. 'bounty.fund' — keys are only unique per scope, not globally. */
  @Column()
  scope: string;

  /**
   * The caller this key belongs to — `req.user.userId` when the route is
   * authenticated, or a documented fallback when it isn't (none of the
   * mutation endpoints this guards currently require auth; see the
   * interceptor for the exact fallback and its tracked limitation).
   */
  @Column()
  callerId: string;

  @Column({
    type: 'enum',
    enum: IdempotencyKeyStatus,
    default: IdempotencyKeyStatus.PROCESSING,
  })
  status: IdempotencyKeyStatus;

  /** HTTP status of the cached outcome, set once status moves to COMPLETED. */
  @Column({ type: 'int', nullable: true })
  responseStatus: number | null;

  /** Response body of the cached outcome, set once status moves to COMPLETED. */
  @Column({ type: 'jsonb', nullable: true })
  responseBody: JsonValue;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Retention TTL (see IdempotencyCleanupService) — completed keys older
   * than this are safe to garbage-collect since no legitimate client retry
   * would plausibly arrive this late.
   */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;
}
