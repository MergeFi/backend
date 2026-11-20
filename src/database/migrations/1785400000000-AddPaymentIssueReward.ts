import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which issue a maintenance-pool payout rewards, and enforces one
 * reward per issue per escrow (#779). The unique index is partial, so payouts
 * that have no issue are not affected.
 */
export class AddPaymentIssueReward1785400000000 implements MigrationInterface {
  name = 'AddPaymentIssueReward1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "issueId" character varying`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_escrow_issue" ON "payments" ("escrowId", "issueId") WHERE "issueId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_payment_escrow_issue"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN IF EXISTS "issueId"`);
  }
}
