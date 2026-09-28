import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { GithubWebhooksService } from './github-webhooks.service';
import { GithubSyncService } from './github-sync.service';
import { BountiesService } from '../bounties/bounties.service';
import { Bounty, WebhookEvent } from '../common/entities';
import { BountyStatus, WebhookEventStatus } from '../common/enums';

/**
 * The three pull_request branches share one linked-issue loop (#316). These
 * tests pin the behaviour of that shared loop per branch, including the case
 * the three pre-extraction copies had drifted on: a merged PR whose bounty is
 * not CLAIMED still gets released.
 */
describe('GithubWebhooksService — shared linked-issue processing (#316)', () => {
  let service: GithubWebhooksService;
  let webhookEventRepo: { create: jest.Mock; save: jest.Mock };
  let bountyRepo: { findOne: jest.Mock };
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

  const PAYLOAD_BASE = {
    number: 7,
    pull_request: {
      html_url: 'https://github.com/acme/repo/pull/7',
      number: 7,
      merged: false,
      body: 'This closes #42',
    },
    repository: { id: 999, full_name: 'acme/repo' },
  };

  const linkedIssue = { id: 'issue-1', bounty: { id: 'bounty-1' } };

  const bountyWithStatus = (status: BountyStatus) => ({
    id: 'bounty-1',
    status,
  });

  beforeEach(async () => {
    webhookEventRepo = {
      create: jest.fn((data: Partial<WebhookEvent>) => ({ id: 'event-1', ...data })),
      save: jest.fn((data: Partial<WebhookEvent>) => Promise.resolve(data)),
    };
    bountyRepo = { findOne: jest.fn() };
    bountiesService = {
      markInReview: jest.fn().mockResolvedValue(undefined),
      markMergedAndRelease: jest.fn().mockResolvedValue(undefined),
      markPrClosedWithoutMerge: jest.fn().mockResolvedValue(undefined),
    };
    syncService = {
      findRepositoryByGithubId: jest.fn().mockResolvedValue({ id: 'repo-uuid-1' }),
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
        { provide: getRepositoryToken(WebhookEvent), useValue: webhookEventRepo },
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: BountiesService, useValue: bountiesService },
        { provide: GithubSyncService, useValue: syncService },
      ],
    }).compile();

    service = module.get(GithubWebhooksService);
  });

  const runPullRequest = async (payload: Record<string, unknown>) =>
    service.handleEvent('pull_request', 'delivery-1', payload, true);

  describe('merged PR branch', () => {
    const mergedPayload = {
      ...PAYLOAD_BASE,
      action: 'closed',
      pull_request: { ...PAYLOAD_BASE.pull_request, merged: true },
    };

    it('marks in review then releases a CLAIMED bounty', async () => {
      syncService.findIssueByRepoAndNumber.mockResolvedValue(linkedIssue);
      bountyRepo.findOne.mockResolvedValue(bountyWithStatus(BountyStatus.CLAIMED));

      await runPullRequest(mergedPayload);

      expect(bountiesService.markInReview).toHaveBeenCalledWith(
        'bounty-1',
        mergedPayload.pull_request.html_url,
        7,
      );
      expect(bountiesService.markMergedAndRelease).toHaveBeenCalledWith('bounty-1');
    });

    it('still releases a bounty that is not CLAIMED, without marking in review', async () => {
      syncService.findIssueByRepoAndNumber.mockResolvedValue(linkedIssue);
      bountyRepo.findOne.mockResolvedValue(bountyWithStatus(BountyStatus.IN_REVIEW));

      await runPullRequest(mergedPayload);

      expect(bountiesService.markInReview).not.toHaveBeenCalled();
      expect(bountiesService.markMergedAndRelease).toHaveBeenCalledWith('bounty-1');
    });
  });

  describe('PR-opened branch', () => {
    const openedPayload = { ...PAYLOAD_BASE, action: 'opened' };

    it('moves a CLAIMED bounty to in review', async () => {
      syncService.findIssueByRepoAndNumber.mockResolvedValue(linkedIssue);
      bountyRepo.findOne.mockResolvedValue(bountyWithStatus(BountyStatus.CLAIMED));

      await runPullRequest(openedPayload);

      expect(bountiesService.markInReview).toHaveBeenCalledWith(
        'bounty-1',
        openedPayload.pull_request.html_url,
        7,
      );
      expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
    });

    it('skips a bounty that is not CLAIMED', async () => {
      syncService.findIssueByRepoAndNumber.mockResolvedValue(linkedIssue);
      bountyRepo.findOne.mockResolvedValue(bountyWithStatus(BountyStatus.OPEN));

      await runPullRequest(openedPayload);

      expect(bountiesService.markInReview).not.toHaveBeenCalled();
    });
  });

  describe('PR-closed-without-merge branch', () => {
    const closedPayload = { ...PAYLOAD_BASE, action: 'closed' };

    it('returns an IN_REVIEW bounty to CLAIMED', async () => {
      syncService.findIssueByRepoAndNumber.mockResolvedValue(linkedIssue);
      bountyRepo.findOne.mockResolvedValue(bountyWithStatus(BountyStatus.IN_REVIEW));

      await runPullRequest(closedPayload);

      expect(bountiesService.markPrClosedWithoutMerge).toHaveBeenCalledWith('bounty-1');
    });

    it('skips a bounty that is not IN_REVIEW', async () => {
      syncService.findIssueByRepoAndNumber.mockResolvedValue(linkedIssue);
      bountyRepo.findOne.mockResolvedValue(bountyWithStatus(BountyStatus.CLAIMED));

      await runPullRequest(closedPayload);

      expect(bountiesService.markPrClosedWithoutMerge).not.toHaveBeenCalled();
    });
  });

  describe('shared lookup and outcome tracking', () => {
    it('skips an issue with no tracked bounty', async () => {
      syncService.findIssueByRepoAndNumber.mockResolvedValue({
        id: 'issue-1',
        bounty: null,
      });
      bountyRepo.findOne.mockResolvedValue(bountyWithStatus(BountyStatus.CLAIMED));

      const event = await runPullRequest({
        ...PAYLOAD_BASE,
        action: 'closed',
        pull_request: { ...PAYLOAD_BASE.pull_request, merged: true },
      });

      expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    });

    it('skips when the issue is not tracked at all', async () => {
      syncService.findIssueByRepoAndNumber.mockResolvedValue(null);
      const event = await runPullRequest({
        ...PAYLOAD_BASE,
        action: 'closed',
        pull_request: { ...PAYLOAD_BASE.pull_request, merged: true },
      });

      expect(bountiesService.markMergedAndRelease).not.toHaveBeenCalled();
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    });

    it('records a per-issue failure without aborting the other linked issues', async () => {
      syncService.findIssueByRepoAndNumber
        .mockResolvedValueOnce(linkedIssue)
        .mockResolvedValueOnce(linkedIssue);
      bountyRepo.findOne
        .mockResolvedValueOnce(bountyWithStatus(BountyStatus.CLAIMED))
        .mockResolvedValueOnce(bountyWithStatus(BountyStatus.CLAIMED));
      bountiesService.markMergedAndRelease
        .mockRejectedValueOnce(new Error('soroban failure'))
        .mockResolvedValueOnce(undefined);

      const event = await runPullRequest({
        ...PAYLOAD_BASE,
        action: 'closed',
        pull_request: {
          ...PAYLOAD_BASE.pull_request,
          merged: true,
          body: 'Closes #42 and closes #43',
        },
      });

      expect(bountiesService.markMergedAndRelease).toHaveBeenCalledTimes(2);
      expect(event.status).toBe(WebhookEventStatus.FAILED);
      expect(event.error).toContain('soroban failure');
    });

    it('de-duplicates an issue number referenced twice in the same PR body', async () => {
      syncService.findIssueByRepoAndNumber.mockResolvedValue(linkedIssue);
      bountyRepo.findOne.mockResolvedValue(bountyWithStatus(BountyStatus.CLAIMED));

      await runPullRequest({
        ...PAYLOAD_BASE,
        action: 'opened',
        pull_request: {
          ...PAYLOAD_BASE.pull_request,
          body: 'Closes #42. Also resolves #42 as discussed.',
        },
      });

      expect(syncService.findIssueByRepoAndNumber).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the PR body links no issue', async () => {
      const event = await runPullRequest({
        ...PAYLOAD_BASE,
        action: 'closed',
        pull_request: { ...PAYLOAD_BASE.pull_request, merged: true, body: 'No links here' },
      });

      expect(syncService.findIssueByRepoAndNumber).not.toHaveBeenCalled();
      expect(event.status).toBe(WebhookEventStatus.PROCESSED);
    });
  });
});
