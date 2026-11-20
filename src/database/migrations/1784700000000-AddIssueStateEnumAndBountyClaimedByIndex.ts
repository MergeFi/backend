import { MigrationInterface, QueryRunner } from 'typeorm';

/** Enforces the Issue lifecycle at the database boundary and indexes contributor lookups. */
export class AddIssueStateEnumAndBountyClaimedByIndex1784700000000 implements MigrationInterface {
  name = 'AddIssueStateEnumAndBountyClaimedByIndex1784700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "issues_state_enum" AS ENUM ('open', 'closed')`,
    );
    await queryRunner.query(`
      ALTER TABLE "issues"
      ALTER COLUMN "state" DROP DEFAULT,
      ALTER COLUMN "state" TYPE "issues_state_enum"
      USING "state"::"issues_state_enum",
      ALTER COLUMN "state" SET DEFAULT 'open'
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bounties_claimedById" ON "bounties" ("claimedById")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bounties_claimedById"`);
    await queryRunner.query(`
      ALTER TABLE "issues"
      ALTER COLUMN "state" DROP DEFAULT,
      ALTER COLUMN "state" TYPE varchar
      USING "state"::text,
      ALTER COLUMN "state" SET DEFAULT 'open'
    `);
    await queryRunner.query(`DROP TYPE "issues_state_enum"`);
  }
}
