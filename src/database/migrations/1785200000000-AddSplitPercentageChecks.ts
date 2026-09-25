import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DB-level range guard for split percentages. Application code validates
 * these, but a bad write via another path (script, manual SQL, future
 * service) could otherwise persist a percentage outside 0..100.
 */
export class AddSplitPercentageChecks1785200000000 implements MigrationInterface {
  name = 'AddSplitPercentageChecks1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "team_member_splits"
      ADD CONSTRAINT "CHK_team_member_splits_percentage_range"
      CHECK ("percentage" >= 0 AND "percentage" <= 100)
    `);
    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD CONSTRAINT "CHK_payments_splitPercentage_range"
      CHECK ("splitPercentage" IS NULL OR ("splitPercentage" >= 0 AND "splitPercentage" <= 100))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "CHK_payments_splitPercentage_range"`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_member_splits" DROP CONSTRAINT IF EXISTS "CHK_team_member_splits_percentage_range"`,
    );
  }
}
