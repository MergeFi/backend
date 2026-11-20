import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSorobanFeeAndDryRunLedger1785500000000
  implements MigrationInterface
{
  name = 'AddSorobanFeeAndDryRunLedger1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "escrows_status_enum" ADD VALUE IF NOT EXISTS 'dry_run'`,
    );
    await queryRunner.query(
      `ALTER TYPE "payments_status_enum" ADD VALUE IF NOT EXISTS 'dry_run'`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrows" ADD COLUMN IF NOT EXISTS "protocolFeeAmount" numeric(20,7) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "isProtocolFee" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "payments" SET "status" = 'failed' WHERE "status" = 'dry_run'`,
    );
    await queryRunner.query(
      `UPDATE "escrows" SET "status" = 'failed' WHERE "status" = 'dry_run'`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP COLUMN IF EXISTS "isProtocolFee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrows" DROP COLUMN IF EXISTS "protocolFeeAmount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrows" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TYPE "payments_status_enum" RENAME TO "payments_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "payments_status_enum" AS ENUM ('pending', 'submitted', 'confirmed', 'failed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "status" TYPE "payments_status_enum" USING "status"::text::"payments_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'pending'`,
    );
    await queryRunner.query(`DROP TYPE "payments_status_enum_old"`);
    await queryRunner.query(
      `ALTER TYPE "escrows_status_enum" RENAME TO "escrows_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "escrows_status_enum" AS ENUM ('pending', 'locked', 'released', 'refunded', 'failed', 'reconciliation_pending')`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrows" ALTER COLUMN "status" TYPE "escrows_status_enum" USING "status"::text::"escrows_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrows" ALTER COLUMN "status" SET DEFAULT 'pending'`,
    );
    await queryRunner.query(`DROP TYPE "escrows_status_enum_old"`);
  }
}
