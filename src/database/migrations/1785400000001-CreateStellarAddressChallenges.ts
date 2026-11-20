import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates stellar_address_challenges (#791): the server-side nonce store that
 * backs proof-of-ownership for PATCH /users/:id/stellar-address. See
 * StellarAddressChallenge (entity) for the single-use consumption rules.
 */
export class CreateStellarAddressChallenges1785400000001
  implements MigrationInterface
{
  name = 'CreateStellarAddressChallenges1785400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "stellar_address_challenges" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "stellarAddress" character varying(56) NOT NULL,
        "nonce" character varying(64) NOT NULL,
        "message" text NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "consumedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_b66db1de3ccb4c3b1896cbaf61f" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_4514be9d91f530802b8ab0a121"
      ON "stellar_address_challenges" ("nonce")
    `);

    await queryRunner.query(`
      ALTER TABLE "stellar_address_challenges"
      ADD CONSTRAINT "FK_03e0d20a29a6ad596f5539a2716"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stellar_address_challenges" DROP CONSTRAINT IF EXISTS "FK_03e0d20a29a6ad596f5539a2716"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_4514be9d91f530802b8ab0a121"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "stellar_address_challenges"`);
  }
}
