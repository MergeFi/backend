import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes the data integrity issue described in #58:
 * Re-points `team_member_splits.userId` foreign key from `ON DELETE CASCADE`
 * to `ON DELETE RESTRICT`.
 *
 * A TeamMemberSplit represents a promised percentage of a bounty payout.
 * Cascading user deletes silently removes individual member splits, causing
 * the remaining split percentages to no longer sum to 100%. When such a bounty
 * is merged and released, `EscrowService.splitRelease` / `assertValidSplits`
 * throws a BadRequestException, permanently locking the funds and stranding
 * the bounty in MERGED state.
 */
export class TeamMemberSplitFkRestrict1784500000000 implements MigrationInterface {
  name = 'TeamMemberSplitFkRestrict1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'team_member_splits',
      'userId',
      'users',
      'RESTRICT',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'team_member_splits',
      'userId',
      'users',
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
