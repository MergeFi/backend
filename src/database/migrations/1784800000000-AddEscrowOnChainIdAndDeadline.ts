import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `escrows.onChainId` and `escrows.deadline` (#158).
 *
 * `onChainId` records the `u64` key an escrow is stored under in the
 * on-chain escrow contract (`escrow::fund`'s `issue_id`), captured at fund
 * time so a later `release`/`refund` targets exactly the same key. Held as
 * `varchar` because a u64 overruns JS's safe-integer range and Postgres
 * `bigint` maps to a JS `string` in TypeORM anyway.
 *
 * `deadline` mirrors the unix-timestamp deadline passed to `escrow::fund`,
 * after which the contract's permissionless refund path opens.
 *
 * Both are nullable with no backfill: rows created before this change ran
 * in Soroban dry-run mode (no real on-chain state to reconcile against),
 * and `EscrowService` falls back to the parent id / configured default
 * when either is absent.
 */
export class AddEscrowOnChainIdAndDeadline1784800000000
  implements MigrationInterface
{
  name = 'AddEscrowOnChainIdAndDeadline1784800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "escrows" ADD COLUMN IF NOT EXISTS "onChainId" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrows" ADD COLUMN IF NOT EXISTS "deadline" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "escrows" DROP COLUMN IF EXISTS "deadline"`,
    );
    await queryRunner.query(
      `ALTER TABLE "escrows" DROP COLUMN IF EXISTS "onChainId"`,
    );
  }
}
