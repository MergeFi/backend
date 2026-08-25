import { MigrationInterface, QueryRunner } from 'typeorm';

export class MaintenancePoolEscrowOneToMany1784500000000 implements MigrationInterface {
  name = 'MaintenancePoolEscrowOneToMany1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add maintenancePoolId column to escrows if not exists (it should already exist)
    // The column already exists from previous migration, but we ensure the foreign key
    await queryRunner.query(`
      ALTER TABLE "escrows" 
      ADD CONSTRAINT "FK_escrows_maintenance_pool" 
      FOREIGN KEY ("maintenancePoolId") REFERENCES "maintenance_pools"("id") ON DELETE SET NULL
    `);

    // Create index for faster lookups
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_escrows_maintenance_pool_id" ON "escrows" ("maintenancePoolId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_escrows_maintenance_pool_id"`);
    await queryRunner.query(`ALTER TABLE "escrows" DROP CONSTRAINT IF EXISTS "FK_escrows_maintenance_pool"`);
  }
}
