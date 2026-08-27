import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes #53: `bounties.issueId` FK was `ON DELETE CASCADE`, unlike every
 * other financial relation touching a Bounty (sponsor/claimedBy/team use
 * SET NULL; escrows.bountyId and payments.escrowId use SET NULL/RESTRICT —
 * see #27's EscrowFkIntegrityAndSponsorId migration). Deleting an Issue
 * must never silently delete the Bounty record, which may reference a
 * funded Escrow. Re-points the FK to RESTRICT — `issueId` is NOT NULL, so
 * SET NULL isn't a valid option here.
 */
export class BountyIssueFkRestrict1785000000000 implements MigrationInterface {
  name = 'BountyIssueFkRestrict1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'bounties',
      'issueId',
      'issues',
      'RESTRICT',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'bounties',
      'issueId',
      'issues',
      'CASCADE',
    );
  }

  /**
   * Finds the existing single-column foreign key from `table.column` and
   * replaces its ON DELETE action in place, preserving whatever name
   * `synchronize` (or a previous migration) originally gave it — this
   * avoids hardcoding TypeORM's auto-generated constraint name, which is a
   * content hash we can't reliably predict across environments.
   */
  private async replaceForeignKeyOnDelete(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    refTable: string,
    onDelete: 'SET NULL' | 'CASCADE' | 'RESTRICT',
  ): Promise<void> {
    const rows = (await queryRunner.query(
      `
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
      WHERE con.contype = 'f'
        AND rel.relname = $1
        AND att.attname = $2
      `,
      [table, column],
    )) as Array<{ conname: string }>;

    if (rows.length === 0) {
      // No pre-existing FK to replace (e.g. a database that never ran
      // `synchronize`) — the entity decorator already declares the correct
      // ON DELETE action, so there's nothing to fix up here.
      return;
    }

    const { conname } = rows[0];
    await queryRunner.query(
      `ALTER TABLE "${table}" DROP CONSTRAINT "${conname}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "${table}" ADD CONSTRAINT "${conname}" FOREIGN KEY ("${column}") REFERENCES "${refTable}"("id") ON DELETE ${onDelete}`,
    );
  }
}
