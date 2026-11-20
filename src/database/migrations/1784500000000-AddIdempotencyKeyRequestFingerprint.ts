import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds IdempotencyKey.requestFingerprint (#54) — a hash of the request's
 * path params and body, checked alongside (key, scope, callerId) so that
 * reusing an Idempotency-Key across two requests targeting different
 * resources on the same scope is rejected instead of silently replaying
 * the wrong cached response. See IdempotencyInterceptor.
 *
 * Nullable: existing rows created before this migration have no
 * fingerprint on record. IdempotencyInterceptor treats a null stored
 * fingerprint as "predates this check" and skips the mismatch check for
 * those rows rather than rejecting an in-flight legitimate retry during
 * the deploy transition — see resolveExisting's doc comment.
 */
export class AddIdempotencyKeyRequestFingerprint1784500000000 implements MigrationInterface {
  name = 'AddIdempotencyKeyRequestFingerprint1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      ADD COLUMN "requestFingerprint" character varying(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "idempotency_keys"
      DROP COLUMN "requestFingerprint"
    `);
  }
}
