import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { GithubWebhooksService } from './github-webhooks.service';
import { GithubSyncService } from './github-sync.service';
import { BountiesService } from '../bounties/bounties.service';
import { Bounty, WebhookEvent } from '../common/entities';
import { WebhookEventStatus } from '../common/enums';
import * as sigUtil from './webhook-signature.util';

describe('GithubWebhooksService', () => {
  let service: GithubWebhooksService;
  let webhookEventRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };
  let issueRepo!: { findOne: jest.Mock };
  let bountyRepo!: { findOne: jest.Mock };
  let bountiesService: {
    markInReview: jest.Mock;
    markMergedAndRelease: jest.Mock;
    markPrClosedWithoutMerge: jest.Mock;
  };
  let syncService: {
    findRepositoryByGithubId: jest.Mock;
    findIssueByRepoAndNumber: jest.Mock;
    upsertIssueRecord: jest.Mock;
  };

  beforeEach(async () => {
    webhookEventRepo = {
      create: jest.fn((data: Partial<WebhookEvent>) => ({
        id: 'event-1',
        ...data,
      })),
      save: jest.fn((data: Partial<WebhookEvent>) => Promise.resolve(data)),
      // No delivery recorded yet unless a test says otherwise (#308).
      findOne: jest.fn().mockResolvedValue(null),
    };
    bountyRepo = { findOne: jest.fn() };
    bountiesService = {
      markInReview: jest.fn().mockResolvedValue(undefined),
      markMergedAndRelease: jest.fn().mockResolvedValue(undefined),
      markPrClosedWithoutMerge: jest.fn().mockResolvedValue(undefined),
    };
    syncService = {
      findRepositoryByGithubId: jest.fn().mockResolvedValue({
        id: 'repo-uuid-1',
      }),
      findIssueByRepoAndNumber: jest.fn(),
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
    syncService.findIssueByRepoAndNumber.mockResolvedValue({
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
    syncService.findIssueByRepoAndNumber.mockResolvedValue({
      id: 'issue-1',
      bounty: { id: 'bounty-1' },
    });
    bountyRepo.findOne.mockResolvedValue({
      id: 'bounty-1',
      status: 'in_review',
    });

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
    const event = await service.handleEvent(
      'pull_request',
      'delivery-3',
      payload,
      true,
    );
    expect(bountiesService.markPrClosedWithoutMerge).toHaveBeenCalledWith(
      'bounty-1',
    );
    expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
    expect(event.status).toBe(WebhookEventStatus.PROCESSED);
  });

  it('skips bounty reset for closed-but-not-merged PR when bounty is not IN_REVIEW', async () => {
    syncService.findIssueByRepoAndNumber.mockResolvedValue({
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
      syncService.findIssueByRepoAndNumber.mockResolvedValue({
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
      syncService.findIssueByRepoAndNumber.mockResolvedValue({
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

      await service.handleEvent(
        'pull_request',
        'delivery-reopen',
        payload,
        true,
      );

      expect(bountiesService.markInReview).not.toHaveBeenCalled();
    });
  });

  describe('per-linked-issue isolation on a merged PR (#47)', () => {
    function mockIssueAndBounty(
      byNumber: Record<number, { bountyId: string; status: string }>,
    ) {
      syncService.findIssueByRepoAndNumber.mockImplementation(
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
    it("resolves a closing keyword qualified with the webhook's own owner/repo", async () => {
      syncService.findIssueByRepoAndNumber.mockResolvedValue({
        id: 'issue-1',
        bounty: { id: 'bounty-1' },
      });
      bountyRepo.findOne.mockResolvedValue({
        id: 'bounty-1',
        status: 'claimed',
      });

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

      expect(syncService.findIssueByRepoAndNumber).not.toHaveBeenCalled();
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

  describe('malformed payloads (#28)', () => {
    it('rejects a pull_request payload missing the pull_request key without throwing', async () => {
      const event = await service.handleEvent(
        'pull_request',
        'delivery-malformed-1',
        {
          action: 'closed',
          number: 1,
          repository: { id: 1, full_name: 'a/b' },
        },
        true,
      );

      expect(event.status).toBe(WebhookEventStatus.INVALID_PAYLOAD);
      expect(event.error).toContain('pull_request');
      expect(syncService.findIssueByRepoAndNumber).not.toHaveBeenCalled();
    });

    it('rejects a pull_request payload whose merged flag has the wrong type', async () => {
      const payload = {
        action: 'closed',
        number: 1,
        pull_request: {
          html_url: 'x',
          number: 1,
          merged: 'yes', // should be a boolean
          body: 'Fixes #1',
        },
        repository: { id: 1, full_name: 'a/b' },
      };

      const event = await service.handleEvent(
        'pull_request',
        'delivery-malformed-2',
        payload,
        true,
      );

      expect(event.status).toBe(WebhookEventStatus.INVALID_PAYLOAD);
      expect(event.error).toContain('merged');
      expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
    });

    it('rejects a pull_request payload missing the repository key', async () => {
      const payload = {
        action: 'closed',
        number: 1,
        pull_request: {
          html_url: 'x',
          number: 1,
          merged: true,
          body: 'Fixes #1',
        },
      };

      const event = await service.handleEvent(
        'pull_request',
        'delivery-malformed-3',
        payload,
        true,
      );

      expect(event.status).toBe(WebhookEventStatus.INVALID_PAYLOAD);
      expect(event.error).toContain('repository');
    });

    it.each([
      ['null', null],
      ['an array', [1, 2, 3]],
      ['a string', 'not an object'],
      ['a number', 42],
    ])(
      'rejects a non-object (%s) pull_request payload without throwing',
      async (_label, badPayload) => {
        const event = await service.handleEvent(
          'pull_request',
          'delivery-malformed-non-object',
          badPayload as unknown as Record<string, unknown>,
          true,
        );

        expect(event.status).toBe(WebhookEventStatus.INVALID_PAYLOAD);
        expect(event.error).toContain('payload');
      },
    );

    it('rejects an issues payload missing the issue key', async () => {
      const event = await service.handleEvent(
        'issues',
        'delivery-malformed-issues',
        { action: 'edited', repository: { id: 1, full_name: 'a/b' } },
        true,
      );

      expect(event.status).toBe(WebhookEventStatus.INVALID_PAYLOAD);
      expect(event.error).toContain('issue');
      expect(syncService.upsertIssueRecord).not.toHaveBeenCalled();
    });

    it('still distinguishes a genuine processing failure as FAILED, not INVALID_PAYLOAD', async () => {
      syncService.findIssueByRepoAndNumber.mockResolvedValue({
        id: 'issue-1',
        bounty: { id: 'bounty-1' },
      });
      bountyRepo.findOne.mockResolvedValue({
        id: 'bounty-1',
        status: 'claimed',
      });
      bountiesService.markMergedAndRelease.mockRejectedValue(
        new Error('escrow release failed'),
      );

      const payload = {
        action: 'closed',
        number: 1,
        pull_request: {
          html_url: 'x',
          number: 1,
          merged: true,
          body: 'Fixes #1',
        },
        repository: { id: 1, full_name: 'a/b' },
      };

      const event = await service.handleEvent(
        'pull_request',
        'delivery-real-failure',
        payload,
        true,
      );

      expect(event.status).toBe(WebhookEventStatus.FAILED);
      expect(event.error).toContain('escrow release failed');
    });
  });

  describe('comma-separated closing references (#309)', () => {
    /** Collects every issue number the merged-PR path ends up releasing. */
    function releasedNumbers(): number[] {
      return issueRepo.findOne.mock.calls.map(
        (call: unknown[]) =>
          (call[0] as { where: { number: number } }).where.number,
      );
    }

    it('links every issue in a comma-separated list after one keyword', async () => {
      issueRepo.findOne.mockResolvedValue(null);
      await service.handleEvent(
        'pull_request',
        'delivery-comma-list',
        {
          action: 'closed',
          number: 11,
          pull_request: {
            html_url: 'https://github.com/acme/repo/pull/11',
            number: 11,
            merged: true,
            body: 'Closes #10, #22, #33',
          },
          repository: { id: 999, full_name: 'acme/repo' },
        },
        true,
      );

      expect(releasedNumbers()).toEqual([10, 22, 33]);
    });

    it('keeps parsing subsequent keyword lists after a comma run', async () => {
      issueRepo.findOne.mockResolvedValue(null);
      await service.handleEvent(
        'pull_request',
        'delivery-comma-then-keyword',
        {
          action: 'closed',
          number: 12,
          pull_request: {
            html_url: 'https://github.com/acme/repo/pull/12',
            number: 12,
            merged: true,
            body: 'This PR closes #10, #22, #33 and also fixes #99.',
          },
          repository: { id: 999, full_name: 'acme/repo' },
        },
        true,
      );

      expect(releasedNumbers()).toEqual([10, 22, 33, 99]);
    });

    it('stops the comma run at the first token that is not a reference', async () => {
      issueRepo.findOne.mockResolvedValue(null);
      await service.handleEvent(
        'pull_request',
        'delivery-comma-stops',
        {
          action: 'closed',
          number: 13,
          pull_request: {
            html_url: 'https://github.com/acme/repo/pull/13',
            number: 13,
            merged: true,
            body: 'Closes #1, and #2',
          },
          repository: { id: 999, full_name: 'acme/repo' },
        },
        true,
      );

      expect(releasedNumbers()).toEqual([1]);
    });

    it('skips a foreign-repo qualifier inside a comma run but keeps the rest', async () => {
      issueRepo.findOne.mockResolvedValue(null);
      await service.handleEvent(
        'pull_request',
        'delivery-comma-foreign',
        {
          action: 'closed',
          number: 14,
          pull_request: {
            html_url: 'https://github.com/acme/repo/pull/14',
            number: 14,
            merged: true,
            body: 'Fixes #7, some-other-org/other-repo#8, #9',
          },
          repository: { id: 999, full_name: 'acme/repo' },
        },
        true,
      );

      expect(releasedNumbers()).toEqual([7, 9]);
    });

    it('marks a comma-separated bounty in review when the PR is opened', async () => {
      issueRepo.findOne.mockImplementation(
        ({ where }: { where: { number: number } }) =>
          Promise.resolve({
            id: `issue-${where.number}`,
            bounty: { id: `bounty-${where.number}` },
          }),
      );
      bountyRepo.findOne.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, status: 'claimed' }),
      );

      await service.handleEvent(
        'pull_request',
        'delivery-comma-opened',
        {
          action: 'opened',
          number: 15,
          pull_request: {
            html_url: 'https://github.com/acme/repo/pull/15',
            number: 15,
            merged: false,
            body: 'Closes #10, #22, #33',
          },
          repository: { id: 999, full_name: 'acme/repo' },
        },
        true,
      );

      expect(bountiesService.markInReview).toHaveBeenCalledTimes(3);
      expect(bountiesService.markInReview).toHaveBeenCalledWith(
        'bounty-10',
        'https://github.com/acme/repo/pull/15',
        15,
      );
      expect(bountiesService.markInReview).toHaveBeenCalledWith(
        'bounty-22',
        'https://github.com/acme/repo/pull/15',
        15,
      );
      expect(bountiesService.markInReview).toHaveBeenCalledWith(
        'bounty-33',
        'https://github.com/acme/repo/pull/15',
        15,
      );
    });
  });

  describe('pull_request edited events (#310)', () => {
    it('moves a bounty to in_review when a closing keyword is added after opening', async () => {
      issueRepo.findOne.mockImplementation(
        ({ where }: { where: { number: number } }) =>
          Promise.resolve({
            id: `issue-${where.number}`,
            bounty: { id: 'bounty-42' },
          }),
      );
      bountyRepo.findOne.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, status: 'claimed' }),
      );

      const event = await service.handleEvent(
        'pull_request',
        'delivery-edited',
        {
          action: 'edited',
          number: 42,
          pull_request: {
            html_url: 'https://github.com/acme/repo/pull/42',
            number: 42,
            merged: false,
            body: 'Added the description: Fixes #42',
          },
          repository: { id: 999, full_name: 'acme/repo' },
        },
        true,
      );

      expect(bountiesService.markInReview).toHaveBeenCalledWith(
        'bounty-42',
        'https://github.com/acme/repo/pull/42',
        42,
      );
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    });

    it('leaves a bounty already in_review untouched on a later body edit', async () => {
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-42',
        bounty: { id: 'bounty-42' },
      });
      bountyRepo.findOne.mockResolvedValue({
        id: 'bounty-42',
        status: 'in_review',
      });

      await service.handleEvent(
        'pull_request',
        'delivery-edited-idem',
        {
          action: 'edited',
          number: 42,
          pull_request: {
            html_url: 'https://github.com/acme/repo/pull/42',
            number: 42,
            merged: false,
            body: 'Fixes #42 (typo fixes)',
          },
          repository: { id: 999, full_name: 'acme/repo' },
        },
        true,
      );

      expect(bountiesService.markInReview).not.toHaveBeenCalled();
    });

    it('still ignores unrelated actions without touching bounties', async () => {
      await service.handleEvent(
        'pull_request',
        'delivery-synchronize',
        {
          action: 'synchronize',
          number: 42,
          pull_request: {
            html_url: 'https://github.com/acme/repo/pull/42',
            number: 42,
            merged: false,
            body: 'Fixes #42',
          },
          repository: { id: 999, full_name: 'acme/repo' },
        },
        true,
      );

      expect(bountiesService.markInReview).not.toHaveBeenCalled();
      expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
    });
  });

  // #308: a redelivered X-GitHub-Delivery used to hit the unique constraint
  // on webhook_events.deliveryId and escape handleEvent as a 500, so every
  // redelivery of that event failed forever.
  describe('duplicate deliveries (#308)', () => {
    const payload = {
      action: 'closed',
      number: 1,
      pull_request: {
        html_url: 'x',
        number: 1,
        merged: true,
        body: 'Fixes #1',
      },
      repository: { id: 1, full_name: 'a/b' },
    };

    it('returns the stored event without re-running business logic', async () => {
      webhookEventRepo.findOne.mockResolvedValueOnce({
        id: 'event-existing',
        deliveryId: 'delivery-dup-1',
        status: WebhookEventStatus.PROCESSED,
      });

      const event = await service.handleEvent(
        'pull_request',
        'delivery-dup-1',
        payload,
        true,
      );

      expect(event.id).toBe('event-existing');
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
      expect(webhookEventRepo.save).not.toHaveBeenCalled();
      expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
    });

    it('treats a unique-constraint violation from a racing delivery as benign', async () => {
      const uniqueViolation = Object.assign(new Error('duplicate key value'), {
        code: '23505',
      });
      webhookEventRepo.save.mockRejectedValueOnce(uniqueViolation);
      webhookEventRepo.findOne
        .mockResolvedValueOnce(null) // first lookup: not recorded yet
        .mockResolvedValueOnce({
          id: 'event-winner',
          deliveryId: 'delivery-race-1',
          status: WebhookEventStatus.PROCESSED,
        });

      const event = await service.handleEvent(
        'pull_request',
        'delivery-race-1',
        payload,
        true,
      );

      expect(event.id).toBe('event-winner');
      expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
    });

    it('rethrows a non-unique insert failure', async () => {
      const dbError = Object.assign(new Error('connection terminated'), {
        code: '08006',
      });
      webhookEventRepo.save.mockRejectedValueOnce(dbError);

      await expect(
        service.handleEvent('pull_request', 'delivery-fail-1', payload, true),
      ).rejects.toThrow('connection terminated');
    });

    it('processes a first-time delivery normally', async () => {
      const event = await service.handleEvent(
        'pull_request',
        'delivery-fresh-1',
        payload,
        true,
      );

      expect(webhookEventRepo.findOne).toHaveBeenCalledWith({
        where: { deliveryId: 'delivery-fresh-1' },
      });
      expect(webhookEventRepo.save).toHaveBeenCalled();
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    });

    it('skips the dedupe lookup for a delivery without an id', async () => {
      const event = await service.handleEvent(
        'pull_request',
        undefined,
        payload,
        true,
      );

      expect(webhookEventRepo.findOne).not.toHaveBeenCalled();
      expect(event.deliveryId).toBeNull();
    });
  });
});
