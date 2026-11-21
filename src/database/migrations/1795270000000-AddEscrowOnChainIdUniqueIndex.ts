import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEscrowOnChainIdUniqueIndex1795270000000
  implements MigrationInterface
{
  name = 'AddEscrowOnChainIdUniqueIndex1795270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_escrow_onChainId" ON "escrows" ("onChainId") WHERE "onChainId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_escrow_onChainId"`);
  }
}
