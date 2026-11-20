import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline schema (#736). Until now the schema was built by `synchronize` and
 * the first migration (EscrowFkIntegrityAndSponsorId1784272650000) began with
 * `ALTER TABLE "escrows"`, so `migration:run` on an empty database failed
 * immediately and the migration set could never be exercised from scratch.
 *
 * This creates the schema exactly as it stood before that first migration:
 * it was produced by synchronizing the current entities, reverting every
 * later migration's `down()`, and dumping what remained. Every subsequent
 * migration therefore applies on top of it unchanged.
 *
 * Databases that predate the migration history were built by `synchronize`
 * and already contain these tables; on those the migration is a no-op (it is
 * still recorded as run), so existing deployments are unaffected.
 */
export class InitialSchema1784000000000 implements MigrationInterface {
  name = 'InitialSchema1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('users')) return;

    for (const statement of BASELINE_STATEMENTS) {
      await queryRunner.query(statement);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of BASELINE_TABLES) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    for (const type of BASELINE_TYPES) {
      await queryRunner.query(`DROP TYPE IF EXISTS "${type}"`);
    }
  }
}

const BASELINE_TABLES = [
  'bounties',
  'escrows',
  'github_accounts',
  'issues',
  'maintenance_pools',
  'milestones',
  'payments',
  'repositories',
  'reputation_snapshots',
  'team_member_splits',
  'teams',
  'users',
  'webhook_events',
];

const BASELINE_TYPES = [
  'bounties_asset_enum',
  'bounties_difficulty_enum',
  'bounties_status_enum',
  'escrows_asset_enum',
  'escrows_status_enum',
  'maintenance_pools_asset_enum',
  'maintenance_pools_status_enum',
  'milestones_asset_enum',
  'milestones_status_enum',
  'payments_asset_enum',
  'payments_status_enum',
  'webhook_events_status_enum',
];

const BASELINE_STATEMENTS = [
  `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public
    `,
  `
      CREATE TYPE bounties_asset_enum AS ENUM (
          'USDC',
          'XLM'
      )
    `,
  `
      CREATE TYPE bounties_difficulty_enum AS ENUM (
          'beginner',
          'intermediate',
          'advanced',
          'expert'
      )
    `,
  `
      CREATE TYPE bounties_status_enum AS ENUM (
          'open',
          'funded',
          'claimed',
          'in_review',
          'merged',
          'release_failed',
          'paid',
          'refunded',
          'expired'
      )
    `,
  `
      CREATE TYPE escrows_asset_enum AS ENUM (
          'USDC',
          'XLM'
      )
    `,
  `
      CREATE TYPE escrows_status_enum AS ENUM (
          'pending',
          'locked',
          'released',
          'refunded',
          'failed',
          'reconciliation_pending'
      )
    `,
  `
      CREATE TYPE maintenance_pools_asset_enum AS ENUM (
          'USDC',
          'XLM'
      )
    `,
  `
      CREATE TYPE maintenance_pools_status_enum AS ENUM (
          'active',
          'paused',
          'closed'
      )
    `,
  `
      CREATE TYPE milestones_asset_enum AS ENUM (
          'USDC',
          'XLM'
      )
    `,
  `
      CREATE TYPE milestones_status_enum AS ENUM (
          'open',
          'funded',
          'in_progress',
          'completed',
          'closed'
      )
    `,
  `
      CREATE TYPE payments_asset_enum AS ENUM (
          'USDC',
          'XLM'
      )
    `,
  `
      CREATE TYPE payments_status_enum AS ENUM (
          'pending',
          'submitted',
          'confirmed',
          'failed'
      )
    `,
  `
      CREATE TYPE webhook_events_status_enum AS ENUM (
          'received',
          'processed',
          'ignored',
          'failed',
          'invalid_payload'
      )
    `,
  `
      CREATE TABLE bounties (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          "issueId" uuid NOT NULL,
          "sponsorId" uuid,
          "claimedById" uuid,
          "teamId" uuid,
          amount numeric(20,7) NOT NULL,
          asset bounties_asset_enum DEFAULT 'USDC'::bounties_asset_enum NOT NULL,
          difficulty bounties_difficulty_enum DEFAULT 'intermediate'::bounties_difficulty_enum NOT NULL,
          status bounties_status_enum DEFAULT 'open'::bounties_status_enum NOT NULL,
          deadline timestamp with time zone,
          "escrowId" character varying,
          "prUrl" character varying,
          "prNumber" integer,
          "claimedAt" timestamp with time zone,
          "mergedAt" timestamp with time zone,
          "paidAt" timestamp with time zone,
          "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
      )
    `,
  `
      CREATE TABLE escrows (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          "bountyId" uuid,
          "milestoneId" uuid,
          "maintenancePoolId" uuid,
          "contractId" character varying,
          amount numeric(20,7) NOT NULL,
          asset escrows_asset_enum DEFAULT 'USDC'::escrows_asset_enum NOT NULL,
          status escrows_status_enum DEFAULT 'pending'::escrows_status_enum NOT NULL,
          "fundedByAddress" character varying,
          "fundTxHash" character varying,
          "releaseTxHash" character varying,
          "refundTxHash" character varying,
          metadata jsonb,
          "lockedAt" timestamp with time zone,
          "releasedAt" timestamp with time zone,
          "refundedAt" timestamp with time zone,
          "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
      )
    `,
  `
      CREATE TABLE github_accounts (
          id integer NOT NULL,
          login character varying NOT NULL,
          "githubId" character varying NOT NULL,
          "avatarUrl" character varying,
          "profileUrl" character varying,
          "userId" uuid NOT NULL,
          "accessToken" character varying,
          "refreshToken" character varying
      )
    `,
  `
      CREATE SEQUENCE github_accounts_id_seq
          AS integer
          START WITH 1
          INCREMENT BY 1
          NO MINVALUE
          NO MAXVALUE
          CACHE 1
    `,
  `
      ALTER SEQUENCE github_accounts_id_seq OWNED BY github_accounts.id
    `,
  `
      CREATE TABLE issues (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          "repositoryId" uuid NOT NULL,
          "githubIssueId" character varying NOT NULL,
          number integer NOT NULL,
          title character varying NOT NULL,
          body text,
          state character varying DEFAULT 'open'::character varying NOT NULL,
          labels text DEFAULT ''::text NOT NULL,
          "githubUrl" character varying NOT NULL,
          "authorLogin" character varying,
          "isMaintenanceType" boolean DEFAULT false NOT NULL,
          "milestoneId" uuid,
          "closedAt" timestamp with time zone,
          "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
      )
    `,
  `
      CREATE TABLE maintenance_pools (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          name character varying NOT NULL,
          "repositoryId" uuid,
          "createdById" uuid,
          "monthlyDeposit" numeric(20,7) DEFAULT '0'::numeric NOT NULL,
          balance numeric(20,7) DEFAULT '0'::numeric NOT NULL,
          asset maintenance_pools_asset_enum DEFAULT 'USDC'::maintenance_pools_asset_enum NOT NULL,
          status maintenance_pools_status_enum DEFAULT 'active'::maintenance_pools_status_enum NOT NULL,
          "escrowId" character varying,
          "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
      )
    `,
  `
      CREATE TABLE milestones (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          "repositoryId" uuid NOT NULL,
          title character varying NOT NULL,
          description text,
          "sponsorId" uuid,
          budget numeric(20,7) NOT NULL,
          distributed numeric(20,7) DEFAULT '0'::numeric NOT NULL,
          asset milestones_asset_enum DEFAULT 'USDC'::milestones_asset_enum NOT NULL,
          status milestones_status_enum DEFAULT 'open'::milestones_status_enum NOT NULL,
          deadline timestamp with time zone,
          "escrowId" character varying,
          "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
      )
    `,
  `
      CREATE TABLE payments (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          "escrowId" uuid NOT NULL,
          "recipientId" uuid,
          "recipientAddress" character varying,
          amount numeric(20,7) NOT NULL,
          asset payments_asset_enum DEFAULT 'USDC'::payments_asset_enum NOT NULL,
          "splitPercentage" numeric(5,2),
          status payments_status_enum DEFAULT 'pending'::payments_status_enum NOT NULL,
          "txHash" character varying,
          "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
      )
    `,
  `
      CREATE TABLE repositories (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          "githubRepoId" character varying NOT NULL,
          owner character varying NOT NULL,
          name character varying NOT NULL,
          "fullName" character varying NOT NULL,
          description text,
          "defaultBranch" character varying DEFAULT 'main'::character varying NOT NULL,
          private boolean DEFAULT false NOT NULL,
          "primaryLanguage" character varying,
          "stargazersCount" integer DEFAULT 0 NOT NULL,
          "maintainerId" uuid,
          "lastSyncedAt" timestamp with time zone,
          "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
      )
    `,
  `
      CREATE TABLE reputation_snapshots (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          "userId" uuid NOT NULL,
          "totalEarnings" numeric(20,7) DEFAULT '0'::numeric NOT NULL,
          "mergedPrCount" integer DEFAULT 0 NOT NULL,
          "openBountiesClaimed" integer DEFAULT 0 NOT NULL,
          "completionRate" numeric(5,2) DEFAULT '0'::numeric NOT NULL,
          "avgReviewTimeHours" numeric(10,2) DEFAULT '0'::numeric NOT NULL,
          "onTimeDeliveryPercentage" numeric(5,2) DEFAULT '0'::numeric NOT NULL,
          languages jsonb,
          "orgsContributedTo" text DEFAULT ''::text NOT NULL,
          "computedAt" timestamp without time zone DEFAULT now() NOT NULL
      )
    `,
  `
      CREATE TABLE team_member_splits (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          "teamId" uuid NOT NULL,
          "userId" uuid,
          role character varying,
          percentage numeric(5,2) NOT NULL,
          "createdAt" timestamp without time zone DEFAULT now() NOT NULL
      )
    `,
  `
      CREATE TABLE teams (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          name character varying NOT NULL,
          "createdById" uuid,
          "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
      )
    `,
  `
      CREATE TABLE users (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          email character varying,
          username character varying NOT NULL,
          "displayName" character varying,
          "avatarUrl" character varying,
          roles text DEFAULT 'contributor'::text NOT NULL,
          "stellarAddress" character varying,
          "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
      )
    `,
  `
      CREATE TABLE webhook_events (
          id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
          provider character varying DEFAULT 'github'::character varying NOT NULL,
          "eventType" character varying NOT NULL,
          "deliveryId" character varying,
          payload jsonb NOT NULL,
          "signatureValid" boolean DEFAULT false NOT NULL,
          status webhook_events_status_enum DEFAULT 'received'::webhook_events_status_enum NOT NULL,
          error text,
          "receivedAt" timestamp without time zone DEFAULT now() NOT NULL,
          "processedAt" timestamp with time zone
      )
    `,
  `
      ALTER TABLE ONLY github_accounts ALTER COLUMN id SET DEFAULT nextval('github_accounts_id_seq'::regclass)
    `,
  `
      ALTER TABLE ONLY github_accounts
          ADD CONSTRAINT "PK_01b75d48868462b91c920cc80dc" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY milestones
          ADD CONSTRAINT "PK_0bdbfe399c777a6a8520ff902d9" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY reputation_snapshots
          ADD CONSTRAINT "PK_0d1d34fa172ec578729f963d84e" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY payments
          ADD CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY bounties
          ADD CONSTRAINT "PK_335c87017bcb2fa9bc15678f385" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY team_member_splits
          ADD CONSTRAINT "PK_410b02a2242c670ea7c126e56de" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY webhook_events
          ADD CONSTRAINT "PK_4cba37e6a0acb5e1fc49c34ebfd" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY teams
          ADD CONSTRAINT "PK_7e5523774a38b08a6236d322403" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY escrows
          ADD CONSTRAINT "PK_9cd10ae5b52350c3a20d124f5d3" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY issues
          ADD CONSTRAINT "PK_9d8ecbbeff46229c700f0449257" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY users
          ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY maintenance_pools
          ADD CONSTRAINT "PK_c815aeb66c88174541699f91c92" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY repositories
          ADD CONSTRAINT "PK_ef0c358c04b4f4d29b8ca68ddff" PRIMARY KEY (id)
    `,
  `
      ALTER TABLE ONLY escrows
          ADD CONSTRAINT "REL_23683b92504180eb6a2a9ac57b" UNIQUE ("maintenancePoolId")
    `,
  `
      ALTER TABLE ONLY escrows
          ADD CONSTRAINT "REL_54b1af06e01e858558a708d47c" UNIQUE ("milestoneId")
    `,
  `
      ALTER TABLE ONLY bounties
          ADD CONSTRAINT "REL_71acf93edc959f8ce15655c553" UNIQUE ("issueId")
    `,
  `
      ALTER TABLE ONLY escrows
          ADD CONSTRAINT "REL_97dfda1a7af84ba52246ea63ac" UNIQUE ("bountyId")
    `,
  `
      ALTER TABLE ONLY webhook_events
          ADD CONSTRAINT "UQ_14ad468bc244178f443e74c18ab" UNIQUE ("deliveryId")
    `,
  `
      ALTER TABLE ONLY github_accounts
          ADD CONSTRAINT "UQ_232599e8862d884cd1251862148" UNIQUE ("githubId")
    `,
  `
      ALTER TABLE ONLY users
          ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE (email)
    `,
  `
      ALTER TABLE ONLY repositories
          ADD CONSTRAINT "UQ_a477894a09b73af227d83951875" UNIQUE ("githubRepoId")
    `,
  `
      ALTER TABLE ONLY issues
          ADD CONSTRAINT "UQ_b35027fb8275efa5631c49b4930" UNIQUE ("githubIssueId")
    `,
  `
      ALTER TABLE ONLY users
          ADD CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE (username)
    `,
  `
      CREATE UNIQUE INDEX "IDX_330c1a4d646cd6faf97421b41d" ON issues USING btree ("repositoryId", number)
    `,
  `
      CREATE INDEX "IDX_68169e2a4f86d243cf83ca0fa2" ON reputation_snapshots USING btree ("userId", "computedAt")
    `,
  `
      CREATE UNIQUE INDEX "IDX_7587f67963409ce7cda271b3f4" ON repositories USING btree (owner, name)
    `,
  `
      ALTER TABLE ONLY payments
          ADD CONSTRAINT "FK_1470f08e6ece0cdd3762e31e676" FOREIGN KEY ("escrowId") REFERENCES escrows(id) ON DELETE CASCADE
    `,
  `
      ALTER TABLE ONLY team_member_splits
          ADD CONSTRAINT "FK_1c326fb8239de37edea45f13001" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE SET NULL
    `,
  `
      ALTER TABLE ONLY escrows
          ADD CONSTRAINT "FK_23683b92504180eb6a2a9ac57b5" FOREIGN KEY ("maintenancePoolId") REFERENCES maintenance_pools(id) ON DELETE CASCADE
    `,
  `
      ALTER TABLE ONLY bounties
          ADD CONSTRAINT "FK_2e1e38ffc1e9670b2b6930a334a" FOREIGN KEY ("teamId") REFERENCES teams(id) ON DELETE SET NULL
    `,
  `
      ALTER TABLE ONLY maintenance_pools
          ADD CONSTRAINT "FK_2ebdffcc91e9eca3d8cbbe53cec" FOREIGN KEY ("createdById") REFERENCES users(id) ON DELETE SET NULL
    `,
  `
      ALTER TABLE ONLY maintenance_pools
          ADD CONSTRAINT "FK_46e3488dbadd29e88f15bc2136a" FOREIGN KEY ("repositoryId") REFERENCES repositories(id) ON DELETE CASCADE
    `,
  `
      ALTER TABLE ONLY teams
          ADD CONSTRAINT "FK_4c0451072950a6582e423c4ccc5" FOREIGN KEY ("createdById") REFERENCES users(id) ON DELETE SET NULL
    `,
  `
      ALTER TABLE ONLY escrows
          ADD CONSTRAINT "FK_54b1af06e01e858558a708d47cb" FOREIGN KEY ("milestoneId") REFERENCES milestones(id) ON DELETE CASCADE
    `,
  `
      ALTER TABLE ONLY bounties
          ADD CONSTRAINT "FK_71acf93edc959f8ce15655c5530" FOREIGN KEY ("issueId") REFERENCES issues(id) ON DELETE CASCADE
    `,
  `
      ALTER TABLE ONLY milestones
          ADD CONSTRAINT "FK_7a8d7498bda37b4c9274b057f32" FOREIGN KEY ("repositoryId") REFERENCES repositories(id) ON DELETE CASCADE
    `,
  `
      ALTER TABLE ONLY escrows
          ADD CONSTRAINT "FK_97dfda1a7af84ba52246ea63ac1" FOREIGN KEY ("bountyId") REFERENCES bounties(id) ON DELETE CASCADE
    `,
  `
      ALTER TABLE ONLY repositories
          ADD CONSTRAINT "FK_9b9725cf37ca454caa2ea001d48" FOREIGN KEY ("maintainerId") REFERENCES users(id) ON DELETE SET NULL
    `,
  `
      ALTER TABLE ONLY milestones
          ADD CONSTRAINT "FK_b090b365d90d6019cde91d75470" FOREIGN KEY ("sponsorId") REFERENCES users(id) ON DELETE SET NULL
    `,
  `
      ALTER TABLE ONLY issues
          ADD CONSTRAINT "FK_b65a339b4ea1cecf21a828eb122" FOREIGN KEY ("repositoryId") REFERENCES repositories(id) ON DELETE CASCADE
    `,
  `
      ALTER TABLE ONLY reputation_snapshots
          ADD CONSTRAINT "FK_be9d6007328af46f7ab34cad8aa" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
    `,
  `
      ALTER TABLE ONLY team_member_splits
          ADD CONSTRAINT "FK_c06a1f8cebdd1e584738c42bdcf" FOREIGN KEY ("teamId") REFERENCES teams(id) ON DELETE CASCADE
    `,
  `
      ALTER TABLE ONLY issues
          ADD CONSTRAINT "FK_cd4e63c7580ac49953a1d86c1ed" FOREIGN KEY ("milestoneId") REFERENCES milestones(id) ON DELETE SET NULL
    `,
  `
      ALTER TABLE ONLY github_accounts
          ADD CONSTRAINT "FK_d9cb91117b84f4c1d9e7b2ddec4" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
    `,
  `
      ALTER TABLE ONLY bounties
          ADD CONSTRAINT "FK_f2db974b9a83f6d88c49e6d4003" FOREIGN KEY ("claimedById") REFERENCES users(id) ON DELETE SET NULL
    `,
  `
      ALTER TABLE ONLY bounties
          ADD CONSTRAINT "FK_f5ffd7906a66c9a15dd0fe825f2" FOREIGN KEY ("sponsorId") REFERENCES users(id) ON DELETE SET NULL
    `,
  `
      ALTER TABLE ONLY payments
          ADD CONSTRAINT "FK_f605003e6dafd6b3ae497c12686" FOREIGN KEY ("recipientId") REFERENCES users(id) ON DELETE SET NULL
    `,
];
