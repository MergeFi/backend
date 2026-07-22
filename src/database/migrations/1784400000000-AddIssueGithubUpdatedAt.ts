import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds Issue.githubUpdatedAt — GitHub's own `updated_at` for the issue, used
 * by GithubSyncService's optimistic-concurrency guard (#24) to stop a sync
 * from clobbering a newer webhook-driven update (or vice versa).
 */
export class AddIssueGithubUpdatedAt1784400000000 implements MigrationInterface {
  name = 'AddIssueGithubUpdatedAt1784400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "issues"
      ADD COLUMN "githubUpdatedAt" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "issues"
      DROP COLUMN "githubUpdatedAt"
    `);
  }
}
