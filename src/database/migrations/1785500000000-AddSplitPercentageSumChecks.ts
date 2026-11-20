import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DB-level guard on the *sum* of split percentages (#836).
 * AddSplitPercentageChecks1785200000002 only bounds each row to 0..100, so a
 * team whose rows are individually valid but total 60% was still accepted —
 * and the sum is what the payout depends on. The invariant is enforced in
 * three application paths (validateSplitPercentages, validatePercentageSplits,
 * apportionBasisPoints); these triggers make it hold for every other write
 * path too (scripts, manual SQL, a non-transactional delete-then-insert such
 * as TeamsService.updateSplits, #728).
 *
 * Both are DEFERRABLE INITIALLY DEFERRED constraint triggers: they run at
 * COMMIT, after every row of the set has been written, so replacing a split
 * set row by row inside one transaction works while a half-written set can't
 * commit. Each trigger re-checks only the team / escrow its row touched, and
 * fires only on writes that can change the sum (not e.g. a payment status
 * update), so pre-existing rows are not re-validated by unrelated writes.
 *
 * - team_member_splits: a non-empty team must total 100. An empty team is
 *   allowed (a newly created team, or one whose splits were cleared).
 *   Tolerance: the app accepts totals within SPLIT_PERCENTAGE_TOLERANCE
 *   (0.01) and then stores each row rounded with toFixed(2), which can move
 *   each row by up to 0.005 — so the bound is 0.01 + 0.005 per row.
 * - payments: for an escrow with split payouts (splitPercentage NOT NULL),
 *   those rows must total 100. EscrowService.splitRelease writes them from
 *   basis points summing to exactly 10000, so 0.01 is ample. Payments without
 *   a splitPercentage (single-recipient and partial releases) are ignored.
 */
export class AddSplitPercentageSumChecks1785500000000 implements MigrationInterface {
  name = 'AddSplitPercentageSumChecks1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_assert_team_member_splits_sum"(p_team_id uuid)
      RETURNS void LANGUAGE plpgsql AS $$
      DECLARE
        v_total numeric;
        v_rows integer;
      BEGIN
        SELECT COALESCE(SUM("percentage"), 0), COUNT(*) INTO v_total, v_rows
        FROM "team_member_splits" WHERE "teamId" = p_team_id;
        IF v_rows > 0 AND ABS(v_total - 100) > 0.01 + 0.005 * v_rows THEN
          RAISE EXCEPTION 'team_member_splits for team % sum to %, expected 100', p_team_id, v_total
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'TRG_team_member_splits_percentage_sum';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_trg_team_member_splits_percentage_sum"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          PERFORM "fn_assert_team_member_splits_sum"(OLD."teamId");
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          PERFORM "fn_assert_team_member_splits_sum"(NEW."teamId");
        END IF;
        RETURN NULL;
      END $$
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "TRG_team_member_splits_percentage_sum"
      AFTER INSERT OR DELETE OR UPDATE OF "percentage", "teamId"
      ON "team_member_splits"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION "fn_trg_team_member_splits_percentage_sum"()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_assert_payments_split_sum"(p_escrow_id uuid)
      RETURNS void LANGUAGE plpgsql AS $$
      DECLARE
        v_total numeric;
        v_rows integer;
      BEGIN
        SELECT COALESCE(SUM("splitPercentage"), 0), COUNT(*) INTO v_total, v_rows
        FROM "payments"
        WHERE "escrowId" = p_escrow_id AND "splitPercentage" IS NOT NULL;
        IF v_rows > 0 AND ABS(v_total - 100) > 0.01 THEN
          RAISE EXCEPTION 'payments.splitPercentage for escrow % sum to %, expected 100', p_escrow_id, v_total
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'TRG_payments_split_percentage_sum';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_trg_payments_split_percentage_sum"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          PERFORM "fn_assert_payments_split_sum"(OLD."escrowId");
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          PERFORM "fn_assert_payments_split_sum"(NEW."escrowId");
        END IF;
        RETURN NULL;
      END $$
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "TRG_payments_split_percentage_sum"
      AFTER INSERT OR DELETE OR UPDATE OF "splitPercentage", "escrowId"
      ON "payments"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION "fn_trg_payments_split_percentage_sum"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_payments_split_percentage_sum" ON "payments"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "fn_trg_payments_split_percentage_sum"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "fn_assert_payments_split_sum"(uuid)`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_team_member_splits_percentage_sum" ON "team_member_splits"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "fn_trg_team_member_splits_percentage_sum"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "fn_assert_team_member_splits_sum"(uuid)`,
    );
  }
}
