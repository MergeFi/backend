import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indexes `webhook_events` for operational reads (#149).
 *
 * The table is append-only and never pruned, so it grows without bound. Only
 * `deliveryId` was indexed (implicitly, via its unique constraint); any query
 * filtering on `eventType` / `status` / `receivedAt` — an admin triage view,
 * a per-type metrics job, "did webhook X ever arrive" debugging — full-scanned
 * it.
 *
 *  - `IDX_webhook_events_type_status` (eventType, status): type/status breakdowns.
 *  - `IDX_webhook_events_status_received_at` (status, receivedAt): the common
 *    "recent failures" query — filter status, order by receivedAt.
 */
export class AddWebhookEventIndexes1784900000000 implements MigrationInterface {
  name = 'AddWebhookEventIndexes1784900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_events_type_status"
      ON "webhook_events" ("eventType", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_events_status_received_at"
      ON "webhook_events" ("status", "receivedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_webhook_events_status_received_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_webhook_events_type_status"`,
    );
  }
}
