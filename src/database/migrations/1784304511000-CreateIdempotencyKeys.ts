import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the idempotency_keys table backing the Idempotency-Key header
 * support added in #16 — see IdempotencyKey (entity), IdempotencyInterceptor,
 * and IdempotencyCleanupService.
 */
export class CreateIdempotencyKeys1784304511000 implements MigrationInterface {
  name = 'CreateIdempotencyKeys1784304511000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "idempotency_keys_status_enum" AS ENUM ('processing', 'completed')
    `);

    await queryRunner.query(`
      CREATE TABLE "idempotency_keys" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "key" character varying NOT NULL,
        "scope" character varying NOT NULL,
        "callerId" character varying NOT NULL,
        "status" "idempotency_keys_status_enum" NOT NULL DEFAULT 'processing',
        "responseStatus" integer,
        "responseBody" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("id")
      )
    `);

    // The concurrency-safety primitive: see IdempotencyKey's doc comment.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_idempotency_keys_key_scope_callerId"
      ON "idempotency_keys" ("key", "scope", "callerId")
    `);

    // Supports IdempotencyCleanupService's periodic DELETE ... WHERE
    // "expiresAt" < now() sweep without a sequential scan.
    await queryRunner.query(`
      CREATE INDEX "IDX_idempotency_keys_expiresAt" ON "idempotency_keys" ("expiresAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_idempotency_keys_expiresAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_idempotency_keys_key_scope_callerId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "idempotency_keys"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "idempotency_keys_status_enum"`,
    );
  }
}
