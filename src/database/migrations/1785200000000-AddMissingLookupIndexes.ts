import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indexes for columns that are live filter/join keys but had none:
 *  - milestones("sponsorId")            (#346)
 *  - bounties("deadline", "status")     (#347) BountyExpiryScheduler's hourly sweep
 *  - repositories("primaryLanguage")    (#348)
 *  - team_member_splits("teamId")       (#349) delete/join key
 */
export class AddMissingLookupIndexes1785200000000 implements MigrationInterface {
  name = 'AddMissingLookupIndexes1785200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_milestones_sponsorId" ON "milestones" ("sponsorId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bounties_deadline_status" ON "bounties" ("deadline", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_repositories_primaryLanguage" ON "repositories" ("primaryLanguage")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_team_member_splits_teamId" ON "team_member_splits" ("teamId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_team_member_splits_teamId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_repositories_primaryLanguage"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bounties_deadline_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_milestones_sponsorId"`);
  }
}
