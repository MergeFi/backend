import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index on payments("escrowId") (#307).
 *
 * `EscrowService.releasePartial` looks up every Payment of an escrow on each
 * call to compute the cumulative released balance before permitting a
 * further partial payout, and that runs once per resolved milestone issue —
 * a hot path that had no supporting index and full-scanned the table.
 */
export class AddPaymentEscrowIndex1785300000000 implements MigrationInterface {
  name = 'AddPaymentEscrowIndex1785300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_escrow" ON "payments" ("escrowId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_escrow"`);
  }
}
