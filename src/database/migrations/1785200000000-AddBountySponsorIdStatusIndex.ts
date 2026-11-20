import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a composite index on bounties("sponsorId", "status") to serve the
 * sponsor-dashboard query (src/sponsors/sponsors.service.ts, activeBounties)
 * that filters `WHERE bounty.sponsorId = :sponsorId AND bounty.status NOT IN (...)`
 * on every dashboard load. Bounty-side counterpart to
 * AddEscrowSponsorIdStatusIndex1784600000000; without it this degrades to a
 * sequential scan as the bounties table grows.
 */
export class AddBountySponsorIdStatusIndex1785200000000 implements MigrationInterface {
  name = 'AddBountySponsorIdStatusIndex1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bounties_sponsorId_status"
      ON "bounties" ("sponsorId", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bounties_sponsorId_status"`);
  }
}
