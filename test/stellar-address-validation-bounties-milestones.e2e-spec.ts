import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { BountiesController } from '../src/bounties/bounties.controller';
import { BountiesService } from '../src/bounties/bounties.service';
import { MilestonesController } from '../src/milestones/milestones.controller';
import { MilestonesService } from '../src/milestones/milestones.service';
import { IdempotencyKeyStatus } from '../src/common/enums';
import { IdempotencyKey } from '../src/common/entities/idempotency-key.entity';
import { IdempotencyInterceptor } from '../src/common/idempotency/idempotency.interceptor';

/** Same in-memory stand-in used across this directory's e2e specs — see
 * escrow-idempotency.e2e-spec.ts's FakeIdempotencyRepo for the rationale
 * behind duplicating it per file instead of sharing one implementation. */
class FakeIdempotencyRepo {
  rows: Partial<IdempotencyKey>[] = [];

  findOneBy(
    where: Partial<IdempotencyKey>,
  ): Promise<Partial<IdempotencyKey> | null> {
    return Promise.resolve(
      this.rows.find((r) =>
        (Object.keys(where) as (keyof IdempotencyKey)[]).every(
          (k) => r[k] === where[k],
        ),
      ) ?? null,
    );
  }

  insert(data: Partial<IdempotencyKey>): Promise<void> {
    this.rows.push({
      ...data,
      status: IdempotencyKeyStatus.PROCESSING,
      responseStatus: null,
      responseBody: null,
      updatedAt: new Date(),
    });
    return Promise.resolve();
  }

  update(
    criteria: Partial<IdempotencyKey>,
    partial: Partial<IdempotencyKey>,
  ): Promise<{ affected: number }> {
    let affected = 0;
    for (const row of this.rows) {
      if (
        (Object.keys(criteria) as (keyof IdempotencyKey)[]).every(
          (k) => row[k] === criteria[k],
        )
      ) {
        Object.assign(row, partial);
        affected += 1;
      }
    }
    return Promise.resolve({ affected });
  }

  delete(criteria: Partial<IdempotencyKey>): Promise<{ affected: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (r) =>
        !(Object.keys(criteria) as (keyof IdempotencyKey)[]).every(
          (k) => r[k] === criteria[k],
        ),
    );
    return Promise.resolve({ affected: before - this.rows.length });
  }
}

function checksumInvalidAddress(): string {
  const valid = Keypair.random().publicKey();
  const flippedChar = valid[10] === 'A' ? 'B' : 'A';
  const candidate = valid.slice(0, 10) + flippedChar + valid.slice(11);
  if (StrKey.isValidEd25519PublicKey(candidate)) {
    return checksumInvalidAddress();
  }
  return candidate;
}

function newFakeRepoProvider() {
  return {
    provide: getRepositoryToken(IdempotencyKey),
    useValue: new FakeIdempotencyRepo(),
  };
}

describe('Stellar address validation at the API boundary — bounties & milestones endpoints (#60)', () => {
  let app: INestApplication;
  let bountiesService: { fund: jest.Mock };
  let milestonesService: { fund: jest.Mock; resolveIssue: jest.Mock };

  beforeAll(async () => {
    bountiesService = {
      fund: jest.fn().mockResolvedValue({ id: 'bounty_1' }),
    };
    milestonesService = {
      fund: jest.fn().mockResolvedValue({ id: 'milestone_1' }),
      resolveIssue: jest.fn().mockResolvedValue({ id: 'milestone_1' }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BountiesController, MilestonesController],
      providers: [
        { provide: BountiesService, useValue: bountiesService },
        { provide: MilestonesService, useValue: milestonesService },
        IdempotencyInterceptor,
        Reflector,
        newFakeRepoProvider(),
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    bountiesService.fund.mockClear();
    milestonesService.fund.mockClear();
    milestonesService.resolveIssue.mockClear();
  });

  const badAddresses = () => [
    '',
    'not-an-address',
    'G'.repeat(55),
    checksumInvalidAddress(),
  ];

  it.each(badAddresses())(
    'rejects POST /bounties/:id/fund with a malformed funderAddress (%p) as 400',
    async (bad) => {
      await request(app.getHttpServer())
        .post('/bounties/bounty_1/fund')
        .set('Idempotency-Key', randomUUID())
        .send({ funderAddress: bad })
        .expect(400);

      expect(bountiesService.fund).not.toHaveBeenCalled();
    },
  );

  it('accepts POST /bounties/:id/fund with a valid funderAddress', async () => {
    await request(app.getHttpServer())
      .post('/bounties/bounty_1/fund')
      .set('Idempotency-Key', randomUUID())
      .send({ funderAddress: Keypair.random().publicKey() })
      .expect(201);

    expect(bountiesService.fund).toHaveBeenCalledTimes(1);
  });

  it.each(badAddresses())(
    'rejects POST /milestones/:id/fund with a malformed funderAddress (%p) as 400',
    async (bad) => {
      await request(app.getHttpServer())
        .post('/milestones/milestone_1/fund')
        .set('Idempotency-Key', randomUUID())
        .send({ funderAddress: bad })
        .expect(400);

      expect(milestonesService.fund).not.toHaveBeenCalled();
    },
  );

  it('accepts POST /milestones/:id/fund with a valid funderAddress', async () => {
    await request(app.getHttpServer())
      .post('/milestones/milestone_1/fund')
      .set('Idempotency-Key', randomUUID())
      .send({ funderAddress: Keypair.random().publicKey() })
      .expect(201);

    expect(milestonesService.fund).toHaveBeenCalledTimes(1);
  });

  it.each(badAddresses())(
    'rejects POST /milestones/:id/issues/:issueId/resolve with a malformed recipientAddress (%p) as 400',
    async (bad) => {
      await request(app.getHttpServer())
        .post('/milestones/milestone_1/issues/issue_1/resolve')
        .set('Idempotency-Key', randomUUID())
        .send({ recipientAddress: bad })
        .expect(400);

      expect(milestonesService.resolveIssue).not.toHaveBeenCalled();
    },
  );

  it('accepts POST /milestones/:id/issues/:issueId/resolve with a valid recipientAddress', async () => {
    await request(app.getHttpServer())
      .post('/milestones/milestone_1/issues/issue_1/resolve')
      .set('Idempotency-Key', randomUUID())
      .send({ recipientAddress: Keypair.random().publicKey() })
      .expect(201);

    expect(milestonesService.resolveIssue).toHaveBeenCalledTimes(1);
  });
});
