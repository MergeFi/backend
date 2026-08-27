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
    markPrClosedWithoutMerge: jest.Mock;
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
      markPrClosedWithoutMerge: jest.fn().mockResolvedValue(undefined),
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

  it.each(['push', 'ping', 'unknown_event'])(
    'ignores a verified %s event when no handler is registered',
    async (eventType) => {
      const event = await service.handleEvent(
        eventType,
        'delivery-unhandled',
        {},
        true,
      );

      expect(event.status).toBe(WebhookEventStatus.IGNORED);
      expect(event.processedAt).toBeUndefined();
      expect(syncService.findRepositoryByGithubId).not.toHaveBeenCalled();
      expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
    },
  );

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

  it('handles a closed-but-not-merged PR by moving linked bounties back to CLAIMED', async () => {
    issueRepo.findOne.mockResolvedValue({
      id: 'issue-1',
      bounty: { id: 'bounty-1' },
    });
    bountyRepo.findOne.mockResolvedValue({ id: 'bounty-1', status: 'in_review' });

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
    const event = await service.handleEvent('pull_request', 'delivery-3', payload, true);
    expect(bountiesService.markPrClosedWithoutMerge).toHaveBeenCalledWith('bounty-1');
    expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
    expect(event.status).toBe(WebhookEventStatus.PROCESSED);
  });

  it('skips bounty reset for closed-but-not-merged PR when bounty is not IN_REVIEW', async () => {
    issueRepo.findOne.mockResolvedValue({
      id: 'issue-1',
      bounty: { id: 'bounty-1' },
    });
    bountyRepo.findOne.mockResolvedValue({ id: 'bounty-1', status: 'claimed' });

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
    await service.handleEvent('pull_request', 'delivery-3b', payload, true);
    expect(bountiesService.markPrClosedWithoutMerge).not.toHaveBeenCalled();
  });

  describe('PR opened / reopened (#168)', () => {
    it('moves a linked CLAIMED bounty to IN_REVIEW when its PR is opened', async () => {
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-1',
        bounty: { id: 'bounty-1' },
      });
      bountyRepo.findOne.mockResolvedValue({
        id: 'bounty-1',
        status: 'claimed',
      });

      const payload = {
        action: 'opened',
        number: 5,
        pull_request: {
          html_url: 'https://github.com/acme/repo/pull/5',
          number: 5,
          merged: false,
          body: 'Fixes #21',
        },
        repository: { id: 999, full_name: 'acme/repo' },
      };

      const event = await service.handleEvent(
        'pull_request',
        'delivery-open',
        payload,
        true,
      );

      expect(bountiesService.markInReview).toHaveBeenCalledWith(
        'bounty-1',
        'https://github.com/acme/repo/pull/5',
        5,
      );
      expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    });

    it('leaves a bounty that is not CLAIMED untouched on a reopened PR', async () => {
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-1',
        bounty: { id: 'bounty-1' },
      });
      bountyRepo.findOne.mockResolvedValue({
        id: 'bounty-1',
        status: 'in_review',
      });

      const payload = {
        action: 'reopened',
        number: 6,
        pull_request: {
          html_url: 'x',
          number: 6,
          merged: false,
          body: 'closes #22',
        },
        repository: { id: 1, full_name: 'a/b' },
      };

      await service.handleEvent('pull_request', 'delivery-reopen', payload, true);

      expect(bountiesService.markInReview).not.toHaveBeenCalled();
    });
  });

  describe('per-linked-issue isolation on a merged PR (#47)', () => {
    function mockIssueAndBounty(
      byNumber: Record<number, { bountyId: string; status: string }>,
    ) {
      issueRepo.findOne.mockImplementation(
        ({ where }: { where: { number: number } }) => {
          const entry = byNumber[where.number];
          return Promise.resolve(
            entry
              ? { id: `issue-${where.number}`, bounty: { id: entry.bountyId } }
              : null,
          );
        },
      );
      bountyRepo.findOne.mockImplementation(
        ({ where }: { where: { id: string } }) => {
          const entry = Object.values(byNumber).find(
            (e) => e.bountyId === where.id,
          );
          return Promise.resolve(
            entry ? { id: where.id, status: entry.status } : null,
          );
        },
      );
    }

    it("processes the first and third linked issues even when the middle one's bounty processing throws", async () => {
      mockIssueAndBounty({
        12: { bountyId: 'bounty-12', status: 'claimed' },
        34: { bountyId: 'bounty-34', status: 'claimed' },
        56: { bountyId: 'bounty-56', status: 'claimed' },
      });
      bountiesService.markMergedAndRelease.mockImplementation((id: string) => {
        if (id === 'bounty-34') {
          return Promise.reject(new Error('escrow release failed'));
        }
        return Promise.resolve(undefined);
      });

      const payload = {
        action: 'closed',
        number: 9,
        pull_request: {
          html_url: 'https://github.com/acme/repo/pull/9',
          number: 9,
          merged: true,
          body: 'Fixes #12. Also fixes #34. Also fixes #56.',
        },
        repository: { id: 999, full_name: 'acme/repo' },
      };

      const event = await service.handleEvent(
        'pull_request',
        'delivery-partial-failure',
        payload,
        true,
      );

      // Both the working bounties were still released — #34's failure
      // didn't abort the loop before reaching #56.
      expect(bountiesService.markMergedAndRelease).toHaveBeenCalledWith(
        'bounty-12',
      );
      expect(bountiesService.markMergedAndRelease).toHaveBeenCalledWith(
        'bounty-34',
      );
      expect(bountiesService.markMergedAndRelease).toHaveBeenCalledWith(
        'bounty-56',
      );
      expect(event.status).toBe(WebhookEventStatus.FAILED);
      expect(event.error).toContain('#34');
      expect(event.error).toContain('escrow release failed');
      // The successful ones aren't mentioned as failures.
      expect(event.error).not.toContain('#12');
      expect(event.error).not.toContain('#56');
    });

    it('does not mark the event FAILED for a benign duplicate issue reference in the PR body', async () => {
      mockIssueAndBounty({
        42: { bountyId: 'bounty-42', status: 'claimed' },
      });
      bountiesService.markMergedAndRelease.mockResolvedValue(undefined);

      const payload = {
        action: 'closed',
        number: 10,
        pull_request: {
          html_url: 'https://github.com/acme/repo/pull/10',
          number: 10,
          merged: true,
          body: 'Fixes #42. This also resolves #42 as discussed in review.',
        },
        repository: { id: 999, full_name: 'acme/repo' },
      };

      const event = await service.handleEvent(
        'pull_request',
        'delivery-duplicate-ref',
        payload,
        true,
      );

      // De-duplicated before processing — only attempted once, not twice.
      expect(bountiesService.markMergedAndRelease).toHaveBeenCalledTimes(1);
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
      expect(event.error).toBeUndefined();
    });
  });

  describe('owner/repo-qualified closing keywords', () => {
    it('resolves a closing keyword qualified with the webhook\'s own owner/repo', async () => {
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-1',
        bounty: { id: 'bounty-1' },
      });
      bountyRepo.findOne.mockResolvedValue({ id: 'bounty-1', status: 'claimed' });

      const payload = {
        action: 'closed',
        number: 11,
        pull_request: {
          html_url: 'https://github.com/acme/repo/pull/11',
          number: 11,
          merged: true,
          body: 'Fixes acme/repo#42',
        },
        repository: { id: 999, full_name: 'acme/repo' },
      };

      const event = await service.handleEvent(
        'pull_request',
        'delivery-same-repo-qualified',
        payload,
        true,
      );

      expect(bountiesService.markMergedAndRelease).toHaveBeenCalledWith(
        'bounty-1',
      );
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    });

    it('does not resolve a closing keyword qualified with a different owner/repo against this repository', async () => {
      const payload = {
        action: 'closed',
        number: 12,
        pull_request: {
          html_url: 'https://github.com/acme/repo/pull/12',
          number: 12,
          merged: true,
          body: 'Fixes some-other-org/some-other-repo#45',
        },
        repository: { id: 999, full_name: 'acme/repo' },
      };

      const event = await service.handleEvent(
        'pull_request',
        'delivery-cross-repo-qualified',
        payload,
        true,
      );

      expect(issueRepo.findOne).not.toHaveBeenCalled();
      expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    });
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
      expect(event.processedAt).toBeInstanceOf(Date);
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
