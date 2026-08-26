import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a composite index on escrows("sponsorId", "status") to serve
 * sponsor-dashboard queries (src/sponsors/sponsors.service.ts) that filter
 * `WHERE escrow.sponsorId = :sponsorId AND escrow.status = :status` —
 * notably SponsorsService.budgetLocked, which runs on every dashboard load.
 */
export class AddEscrowSponsorIdStatusIndex1784600000000 implements MigrationInterface {
  name = 'AddEscrowSponsorIdStatusIndex1784600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_escrow_sponsor_status"
      ON "escrows" ("sponsorId", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_escrow_sponsor_status"`,
    );
  }
}
