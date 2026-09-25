import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Composite + partial indexes for contributor analytics (heatmap / top
 * clients / earnings filtered by claimedById+status) and the homepage
 * SUM(amount) WHERE status = 'paid'.
 */
export class AddAnalyticsBountyIndexes1785100000000 implements MigrationInterface {
  name = 'AddAnalyticsBountyIndexes1785100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bounties_claimedById_status"
      ON "bounties" ("claimedById", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bounties_status_paid"
      ON "bounties" ("status")
      WHERE "status" = 'paid'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bounties_paidAt_paid"
      ON "bounties" ("paidAt")
      WHERE "status" = 'paid' AND "paidAt" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bounties_paidAt_paid"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bounties_status_paid"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bounties_claimedById_status"`,
    );
  }
}
