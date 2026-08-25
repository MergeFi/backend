import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replaces the CASCADE FK on team_member_splits.userId with RESTRICT.
 * This prevents silent desync of team split percentages when a user is deleted.
 * Mirrors the approach in 1784272650000-EscrowFkIntegrityAndSponsorId.ts.
 */
export class TeamMemberSplitUserFkRestrict1784500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the existing CASCADE FK
    await queryRunner.query(`
      ALTER TABLE "team_member_splits"
      DROP CONSTRAINT IF EXISTS "FK_team_member_splits_userId"
    `);

    // Add the new RESTRICT FK
    await queryRunner.query(`
      ALTER TABLE "team_member_splits"
      ADD CONSTRAINT "FK_team_member_splits_userId"
      FOREIGN KEY ("userId")
      REFERENCES "users" ("id")
      ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to CASCADE
    await queryRunner.query(`
      ALTER TABLE "team_member_splits"
      DROP CONSTRAINT IF EXISTS "FK_team_member_splits_userId"
    `);

    await queryRunner.query(`
      ALTER TABLE "team_member_splits"
      ADD CONSTRAINT "FK_team_member_splits_userId"
      FOREIGN KEY ("userId")
      REFERENCES "users" ("id")
      ON DELETE CASCADE
    `);
  }
}