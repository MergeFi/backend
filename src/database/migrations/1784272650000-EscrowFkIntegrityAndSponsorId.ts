import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * First migration in the project (previously schema was managed entirely by
 * `synchronize`, with no migration history at all — see #27's "Difficulty
 * Justification"). Fixes the escrow FK-integrity gaps described in #27:
 *
 *  1. Adds `escrows.sponsorId`, a denormalized copy of the owning
 *     bounty/milestone's sponsor, backfilled from existing rows. Sponsor
 *     dashboard aggregates read this column directly so they stay correct
 *     even if the parent bounty/milestone row is later deleted.
 *  2. Re-points `escrows.bountyId` / `milestoneId` / `maintenancePoolId`'s
 *     foreign keys from `ON DELETE CASCADE` to `ON DELETE SET NULL` —
 *     deleting a bounty/milestone/pool must never delete the escrow ledger
 *     row for funds that may still be LOCKED on-chain.
 *  3. Re-points `payments.escrowId`'s foreign key from `ON DELETE CASCADE`
 *     to `ON DELETE RESTRICT` — a Payment is a record of money that already
 *     moved; deleting its parent Escrow must never silently delete that
 *     record too.
 *  4. Adds a CHECK constraint enforcing that exactly one of `bountyId` /
 *     `milestoneId` / `maintenancePoolId` is non-null on every Escrow row.
 */
export class EscrowFkIntegrityAndSponsorId1784272650000 implements MigrationInterface {
  name = 'EscrowFkIntegrityAndSponsorId1784272650000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "escrows" ADD COLUMN IF NOT EXISTS "sponsorId" varchar`,
    );

    await queryRunner.query(`
      UPDATE "escrows" e
      SET "sponsorId" = b."sponsorId"
      FROM "bounties" b
      WHERE e."bountyId" = b."id" AND e."sponsorId" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "escrows" e
      SET "sponsorId" = m."sponsorId"
      FROM "milestones" m
      WHERE e."milestoneId" = m."id" AND e."sponsorId" IS NULL
    `);

    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'escrows',
      'bountyId',
      'bounties',
      'SET NULL',
    );
    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'escrows',
      'milestoneId',
      'milestones',
      'SET NULL',
    );
    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'escrows',
      'maintenancePoolId',
      'maintenance_pools',
      'SET NULL',
    );
    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'payments',
      'escrowId',
      'escrows',
      'RESTRICT',
    );

    await queryRunner.query(`
      ALTER TABLE "escrows"
      ADD CONSTRAINT "CHK_escrow_exactly_one_parent"
      CHECK (
        (
          (CASE WHEN "bountyId" IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN "milestoneId" IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN "maintenancePoolId" IS NOT NULL THEN 1 ELSE 0 END)
        ) = 1
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "escrows" DROP CONSTRAINT IF EXISTS "CHK_escrow_exactly_one_parent"`,
    );

    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'payments',
      'escrowId',
      'escrows',
      'CASCADE',
    );
    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'escrows',
      'maintenancePoolId',
      'maintenance_pools',
      'CASCADE',
    );
    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'escrows',
      'milestoneId',
      'milestones',
      'CASCADE',
    );
    await this.replaceForeignKeyOnDelete(
      queryRunner,
      'escrows',
      'bountyId',
      'bounties',
      'CASCADE',
    );

    await queryRunner.query(
      `ALTER TABLE "escrows" DROP COLUMN IF EXISTS "sponsorId"`,
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
