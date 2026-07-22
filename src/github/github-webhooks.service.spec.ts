import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { GithubWebhooksService } from './github-webhooks.service';
import { GithubSyncService } from './github-sync.service';
import { BountiesService } from '../bounties/bounties.service';
import { Bounty, Issue, WebhookEvent } from '../common/entities';
import { WebhookEventStatus } from '../common/enums';
import * as sigUtil from './webhook-signature.util';

describe('GithubWebhooksService', () => {
  let service: GithubWebhooksService;
  let webhookEventRepo: { create: jest.Mock; save: jest.Mock };
  let issueRepo: { findOne: jest.Mock };
  let bountyRepo: { findOne: jest.Mock };
  let bountiesService: {
    markInReview: jest.Mock;
    markMergedAndRelease: jest.Mock;
  };
  let syncService: {
    findRepositoryByGithubId: jest.Mock;
    upsertIssueRecord: jest.Mock;
  };

  beforeEach(async () => {
    webhookEventRepo = {
      create: jest.fn((data: Partial<WebhookEvent>) => ({
        id: 'event-1',
        ...data,
      })),
      save: jest.fn((data: Partial<WebhookEvent>) => Promise.resolve(data)),
    };
    issueRepo = { findOne: jest.fn() };
    bountyRepo = { findOne: jest.fn() };
    bountiesService = {
      markInReview: jest.fn().mockResolvedValue(undefined),
      markMergedAndRelease: jest.fn().mockResolvedValue(undefined),
    };
    syncService = {
      findRepositoryByGithubId: jest.fn(),
      upsertIssueRecord: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubWebhooksService,
        {
          provide: ConfigService,
          useValue: { get: () => ({ webhookSecret: 'secret' }) },
        },
        {
          provide: getRepositoryToken(WebhookEvent),
          useValue: webhookEventRepo,
        },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: BountiesService, useValue: bountiesService },
        { provide: GithubSyncService, useValue: syncService },
      ],
    }).compile();

    service = module.get(GithubWebhooksService);
  });

  it('delegates signature verification to verifyGithubSignature', () => {
    const spy = jest
      .spyOn(sigUtil, 'verifyGithubSignature')
      .mockReturnValue(true);
    const result = service.verifySignature(Buffer.from('{}'), 'sha256=abc');
    expect(spy).toHaveBeenCalled();
    expect(result).toBe(true);
    spy.mockRestore();
  });

  it('records but ignores events with an invalid signature', async () => {
    const event = await service.handleEvent(
      'pull_request',
      'delivery-1',
      {},
      false,
    );
    expect(event.status).toBe(WebhookEventStatus.IGNORED);
    expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
  });

  it('processes a merged pull_request event and releases the linked bounty', async () => {
    issueRepo.findOne.mockResolvedValue({
      id: 'issue-1',
      bounty: { id: 'bounty-1' },
    });
    bountyRepo.findOne.mockResolvedValue({ id: 'bounty-1', status: 'claimed' });

    const payload = {
      action: 'closed',
      number: 7,
      pull_request: {
        html_url: 'https://github.com/acme/repo/pull/7',
        number: 7,
        merged: true,
        body: 'This closes #42 for good',
      },
      repository: { id: 999, full_name: 'acme/repo' },
    };

    const event = await service.handleEvent(
      'pull_request',
      'delivery-2',
      payload,
      true,
    );

    expect(bountiesService.markInReview).toHaveBeenCalledWith(
      'bounty-1',
      payload.pull_request.html_url,
      7,
    );
    expect(bountiesService.markMergedAndRelease).toHaveBeenCalledWith(
      'bounty-1',
    );
    expect(event.status).toBe(WebhookEventStatus.PROCESSED);
  });

  it('ignores a closed-but-not-merged pull_request event', async () => {
    const payload = {
      action: 'closed',
      number: 8,
      pull_request: {
        html_url: 'x',
        number: 8,
        merged: false,
        body: 'closes #1',
      },
      repository: { id: 1, full_name: 'a/b' },
    };
    await service.handleEvent('pull_request', 'delivery-3', payload, true);
    expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
  });

  describe('"issues" webhook events (#24)', () => {
    const payload = {
      action: 'edited',
      issue: {
        id: 555,
        number: 12,
        title: 'Updated title',
        state: 'open',
        html_url: 'https://github.com/acme/widgets/issues/12',
        updated_at: '2026-01-10T00:00:00Z',
      },
      repository: { id: 42, full_name: 'acme/widgets' },
    };

    it('delegates to the same guarded upsert sync uses, for a tracked repository', async () => {
      syncService.findRepositoryByGithubId.mockResolvedValue({ id: 'repo-1' });
      syncService.upsertIssueRecord.mockResolvedValue({
        issue: { id: 'issue-1' },
        applied: true,
      });

      const event = await service.handleEvent(
        'issues',
        'delivery-4',
        payload,
        true,
      );

      expect(syncService.findRepositoryByGithubId).toHaveBeenCalledWith('42');
      expect(syncService.upsertIssueRecord).toHaveBeenCalledWith(
        'repo-1',
        payload.issue,
      );
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    });

    it('ignores events for a repository this app is not tracking, without erroring', async () => {
      syncService.findRepositoryByGithubId.mockResolvedValue(null);

      const event = await service.handleEvent(
        'issues',
        'delivery-5',
        payload,
        true,
      );

      expect(syncService.upsertIssueRecord).not.toHaveBeenCalled();
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    });

    it('still marks the event processed when the upsert is rejected as stale', async () => {
      syncService.findRepositoryByGithubId.mockResolvedValue({ id: 'repo-1' });
      syncService.upsertIssueRecord.mockResolvedValue({
        issue: { id: 'issue-1' },
        applied: false,
      });

      const event = await service.handleEvent(
        'issues',
        'delivery-6',
        payload,
        true,
      );

      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    });
  });
});
