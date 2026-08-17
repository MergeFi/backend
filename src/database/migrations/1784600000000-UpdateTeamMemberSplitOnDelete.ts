import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateTeamMemberSplitOnDelete1784600000000 implements MigrationInterface {
  name = 'UpdateTeamMemberSplitOnDelete1784600000000';

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
