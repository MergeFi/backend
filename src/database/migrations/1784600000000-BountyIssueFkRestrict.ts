import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes the financial FK integrity issue described in #53:
 * Re-points `bounties.issueId` foreign key from `ON DELETE CASCADE`
 * to `ON DELETE RESTRICT`.
 *
 * `Bounty` holds financial and workflow state (`status`, `amount`, `claimedById`,
 * `teamId`, `escrowId`, `prUrl`, `claimedAt`, `mergedAt`, `paidAt`). If the linked
 * `Issue` is deleted (or its parent `Repository` deleted via cascade), a CASCADE
 * delete on `Bounty.issue` would hard-delete an active, funded, or merged Bounty,
 * stranding any LOCKED escrow funds with orphaned null parent references.
 *
 * Using `RESTRICT` prevents deletion of an `Issue` when a `Bounty` is attached.
 */
export class BountyIssueFkRestrict1784600000000 implements MigrationInterface {
  name = 'BountyIssueFkRestrict1784600000000';

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
   * `synchronize` (or a previous migration) originally gave it.
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
