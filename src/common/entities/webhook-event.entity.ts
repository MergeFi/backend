import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WebhookEventStatus } from '../enums';

/** Audit log of every inbound webhook, verified or not, for replay/debugging. */
@Entity('webhook_events')
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
