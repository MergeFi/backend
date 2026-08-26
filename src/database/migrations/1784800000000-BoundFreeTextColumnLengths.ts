import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Caps previously-unbounded free-text varchar columns so an arbitrarily large
 * string can no longer be stored in a team member's `role`, a milestone
 * `title`, or a maintenance pool `name` (#151). Matches the `@MaxLength(...)`
 * constraints added to the corresponding DTOs.
 */
export class BoundFreeTextColumnLengths1784800000000
  implements MigrationInterface
{
  name = 'BoundFreeTextColumnLengths1784800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "team_member_splits" ALTER COLUMN "role" TYPE character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestones" ALTER COLUMN "title" TYPE character varying(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance_pools" ALTER COLUMN "name" TYPE character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "maintenance_pools" ALTER COLUMN "name" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestones" ALTER COLUMN "title" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "team_member_splits" ALTER COLUMN "role" TYPE character varying`,
    );
  }
}
