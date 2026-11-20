import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which authenticated user deposited into a maintenance pool (#798).
 * Nullable, no foreign key: matches the denormalized `sponsorId` column and
 * keeps escrow rows intact if the user row is ever removed.
 */
export class AddEscrowDepositedById1785400000000 implements MigrationInterface {
  name = 'AddEscrowDepositedById1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "escrows" ADD COLUMN IF NOT EXISTS "depositedById" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "escrows" DROP COLUMN IF EXISTS "depositedById"`,
    );
  }
}
