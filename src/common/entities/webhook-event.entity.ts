import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WebhookEventStatus } from '../enums';

/**
 * Audit log of every inbound webhook, verified or not, for replay/debugging.
 *
 * This is an append-only, never-pruned table (unlike `IdempotencyKey`, which
 * has TTL cleanup), so operational reads must not full-scan it (#149):
 *  - `IDX_webhook_events_type_status` serves "by event type / status"
 *    breakdowns (e.g. a metrics job, an admin triage list).
 *  - `IDX_webhook_events_status_received_at` serves the "recent FAILED
 *    events" query — filter on `status`, order by `receivedAt DESC`.
 */
@Entity('webhook_events')
@Index('IDX_webhook_events_type_status', ['eventType', 'status'])
@Index('IDX_webhook_events_status_received_at', ['status', 'receivedAt'])
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'github' })
  provider: string;

  @Column()
  eventType: string;

  @Column({ type: 'varchar', nullable: true, unique: true })
  deliveryId: string | null;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ default: false })
  signatureValid: boolean;

  @Column({
    type: 'enum',
    enum: WebhookEventStatus,
    default: WebhookEventStatus.RECEIVED,
  })
  status: WebhookEventStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  receivedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
