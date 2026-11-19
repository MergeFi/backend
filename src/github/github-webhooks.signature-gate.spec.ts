import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { BountiesService } from '../bounties/bounties.service';
import { Bounty, WebhookEvent } from '../common/entities';
import { WebhookEventStatus } from '../common/enums';
import { GithubSyncService } from './github-sync.service';
import { GithubWebhooksController } from './github-webhooks.controller';
import { GithubWebhooksService } from './github-webhooks.service';

const WEBHOOK_SECRET = 'signature-gate-spec-secret';

/**
 * In-memory stand-in for the `webhook_events` table: just enough of
 * Repository<WebhookEvent> for GithubWebhooksService.handleEvent, keyed by id
 * so a second save() of the same event updates rather than duplicates.
 */
class FakeWebhookEventRepo {
  rows = new Map<string, WebhookEvent>();

  create(data: Partial<WebhookEvent>): WebhookEvent {
    return { ...data } as WebhookEvent;
  }

  save(event: WebhookEvent): Promise<WebhookEvent> {
    if (!event.id) event.id = randomUUID();
    this.rows.set(event.id, { ...event });
    return Promise.resolve(event);
  }

  findOne({
    where,
  }: {
    where: Partial<WebhookEvent>;
  }): Promise<WebhookEvent | null> {
    for (const row of this.rows.values()) {
      if (row.deliveryId === where.deliveryId) return Promise.resolve(row);
    }
    return Promise.resolve(null);
  }
}

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/**
 * Pins the ordering property for the only unauthenticated write endpoint:
 * the signature check runs before anything is persisted, so an unverified
 * delivery leaves webhook_events untouched (#845, regression guard for #735).
 * Runs the real controller, service and HMAC check over HTTP with the raw
 * body captured exactly as main.ts configures it (`rawBody: true`).
 */
describe('POST /github/webhooks — signature gate (#845)', () => {
  let app: INestApplication;
  let webhookEvents: FakeWebhookEventRepo;

  const body = JSON.stringify({ zen: 'Keep it logically awesome.' });

  beforeEach(async () => {
    webhookEvents = new FakeWebhookEventRepo();

    const moduleRef = await Test.createTestingModule({
      controllers: [GithubWebhooksController],
      providers: [
        GithubWebhooksService,
        {
          provide: ConfigService,
          useValue: { get: () => ({ webhookSecret: WEBHOOK_SECRET }) },
        },
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: webhookEvents,
        },
        { provide: getRepositoryToken(Bounty), useValue: {} },
        { provide: BountiesService, useValue: {} },
        { provide: GithubSyncService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function deliver(signature: string | undefined, deliveryId = 'delivery-1') {
    const req = request(app.getHttpServer())
      .post('/github/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'ping')
      .set('X-GitHub-Delivery', deliveryId);
    if (signature !== undefined) req.set('X-Hub-Signature-256', signature);
    return req.send(body);
  }

  describe('an invalid signature', () => {
    it('is refused with 401 and writes no row', async () => {
      const res = await deliver('sha256=' + '0'.repeat(64));

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        statusCode: 401,
        message: 'Invalid webhook signature',
        error: 'Unauthorized',
      });
      expect(webhookEvents.rows.size).toBe(0);
    });

    it('is refused when signed with the wrong secret', async () => {
      const res = await deliver(sign(body, 'some-other-secret'));

      expect(res.status).toBe(401);
      expect(webhookEvents.rows.size).toBe(0);
    });

    it('is refused when the signature header is missing', async () => {
      const res = await deliver(undefined);

      expect(res.status).toBe(401);
      expect(webhookEvents.rows.size).toBe(0);
    });

    it('is refused when the body was altered after signing', async () => {
      const res = await request(app.getHttpServer())
        .post('/github/webhooks')
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Event', 'ping')
        .set('X-GitHub-Delivery', 'delivery-tampered')
        .set('X-Hub-Signature-256', sign(body))
        .send(JSON.stringify({ zen: 'tampered' }));

      expect(res.status).toBe(401);
      expect(webhookEvents.rows.size).toBe(0);
    });

    it('does not accumulate rows across repeated unsigned deliveries', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await deliver('sha256=bad', `flood-${i}`);
        expect(res.status).toBe(401);
      }
      expect(webhookEvents.rows.size).toBe(0);
    });
  });

  describe('a valid signature', () => {
    it('is accepted with 202 and writes exactly one row', async () => {
      const res = await deliver(sign(body));

      expect(res.status).toBe(202);
      expect(webhookEvents.rows.size).toBe(1);

      const [row] = [...webhookEvents.rows.values()];
      expect(res.body).toEqual({
        received: true,
        eventId: row.id,
        status: WebhookEventStatus.PROCESSED,
      });
      expect(row).toMatchObject({
        eventType: 'ping',
        deliveryId: 'delivery-1',
        signatureValid: true,
        status: WebhookEventStatus.PROCESSED,
        payload: JSON.parse(body),
      });
    });

    it('still writes one row when the same delivery is redelivered', async () => {
      await deliver(sign(body));
      const res = await deliver(sign(body));

      expect(res.status).toBe(202);
      expect(webhookEvents.rows.size).toBe(1);
    });
  });
});
