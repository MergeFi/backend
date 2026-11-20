import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds users.tokenVersion (#774). Every JWT carries the version it was issued
 * under; bumping the column invalidates all of that user's outstanding tokens.
 */
export class AddUserTokenVersion1785400000003 implements MigrationInterface {
  name = 'AddUserTokenVersion1785400000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tokenVersion" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "tokenVersion"`,
    );
  }
}
