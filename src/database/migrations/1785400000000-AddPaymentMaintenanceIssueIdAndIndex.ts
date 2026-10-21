import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes #458: Add maintenanceIssueId to payments and unique index
 * on (escrowId, maintenanceIssueId) to prevent double payouts for the
 * same maintenance issue.
 */
export class AddPaymentMaintenanceIssueIdAndIndex1785400000000
  implements MigrationInterface
{
  name = 'AddPaymentMaintenanceIssueIdAndIndex1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "maintenanceIssueId" character varying`,
    );
    const fkCheck = (await queryRunner.query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'FK_payment_maintenance_issue'
    `)) as Array<unknown>;
    if (!fkCheck || fkCheck.length === 0) {
      await queryRunner.query(
        `ALTER TABLE "payments" ADD CONSTRAINT "FK_payment_maintenance_issue" FOREIGN KEY ("maintenanceIssueId") REFERENCES "issues"("id") ON DELETE SET NULL`,
      );
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_escrow_maintenance_issue" ON "payments" ("escrowId", "maintenanceIssueId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_payment_escrow_maintenance_issue"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "FK_payment_maintenance_issue"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN IF EXISTS "maintenanceIssueId"`,
    );
  }
}
