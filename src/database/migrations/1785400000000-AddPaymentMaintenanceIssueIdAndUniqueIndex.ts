import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `payments.maintenanceIssueId` and unique index `UQ_payment_escrow_maintenance_issue` (#458).
 *
 * Prevents race conditions and duplicate reward payouts for the same maintenance issue
 * from a pool escrow.
 */
export class AddPaymentMaintenanceIssueIdAndUniqueIndex1785400000000
  implements MigrationInterface
{
  name = 'AddPaymentMaintenanceIssueIdAndUniqueIndex1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "maintenanceIssueId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_payment_maintenance_issue" FOREIGN KEY ("maintenanceIssueId") REFERENCES "issues"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_escrow_maintenance_issue" ON "payments" ("escrowId", "maintenanceIssueId") WHERE "maintenanceIssueId" IS NOT NULL`,
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
