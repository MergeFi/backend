import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Issue, Repository } from '../common/entities';
import {
  GithubSyncInterruptedError,
  GithubSyncService,
  RawGithubIssue,
} from './github-sync.service';
import { GITHUB_OCTOKIT } from './octokit.provider';

function issuePage(items: Array<Partial<RawGithubIssue>>) {
  return {
    data: items.map((item) => ({
      id: 1,
      number: 1,
      title: 'untitled',
      state: 'open',
      html_url: 'https://github.com/a/b/issues/1',
      updated_at: '2026-01-01T00:00:00Z',
      ...item,
    })),
  };
}

/**
 * Mimics `octokit.paginate.iterator`'s async-generator contract. A plain
 * (non-async) generator satisfies `for await...of` just as well when there's
 * nothing to actually await between yields.
 */
function* pagesThenThrow(
  pages: Array<ReturnType<typeof issuePage>>,
  error?: Error,
) {
  for (const page of pages) {
    yield page;
  }
  if (error) throw error;
}

describe('GithubSyncService', () => {
  let service: GithubSyncService;
  let octokit: {
    repos: { get: jest.Mock };
    pulls: { get: jest.Mock };
    issues: { listForRepo: jest.Mock };
    paginate: { iterator: jest.Mock };
    rest: { rateLimit: { get: jest.Mock } };
  };
  let repositoryRepo: {
    findOne: jest.Mock;
    merge: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let issueRepo: {
    findOne: jest.Mock;
    merge: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
    octokit = {
      repos: { get: jest.fn() },
      pulls: { get: jest.fn() },
      issues: { listForRepo: jest.fn() },
      paginate: { iterator: jest.fn() },
      rest: { rateLimit: { get: jest.fn() } },
    };
    repositoryRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      merge: jest.fn((existing: object, attrs: Record<string, unknown>) => ({
        ...existing,
        ...attrs,
      })),
      create: jest.fn((attrs: Record<string, unknown>) => ({
        id: 'repo-1',
        ...attrs,
      })),
      save: jest.fn((repo: object) => Promise.resolve(repo)),
    };
    issueRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      merge: jest.fn((existing: object, attrs: Record<string, unknown>) => ({
        ...existing,
        ...attrs,
      })),
      create: jest.fn((attrs: Record<string, unknown>) => ({
        id: `issue-${String(attrs.githubIssueId)}`,
        ...attrs,
      })),
      save: jest.fn((issue: object) => Promise.resolve(issue)),
    };

    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    octokit.rest.rateLimit.get.mockResolvedValue({
      data: {
        resources: {
          core: { limit: 5000, remaining: 4999, reset: 1234567890 },
        },
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubSyncService,
        { provide: GITHUB_OCTOKIT, useValue: octokit },
        { provide: getRepositoryToken(Repository), useValue: repositoryRepo },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
      ],
    }).compile();

    service = module.get(GithubSyncService);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('syncIssues', () => {
    it('persists issues page by page and skips pull requests', async () => {
      octokit.paginate.iterator.mockReturnValue(
        pagesThenThrow([
          issuePage([
            {
              id: 1,
              number: 1,
              title: 'Issue one',
              updated_at: '2026-01-01T00:00:00Z',
            },
            { id: 2, number: 2, title: 'A PR', pull_request: {} },
          ]),
          issuePage([
            {
              id: 3,
              number: 3,
              title: 'Issue three',
              updated_at: '2026-01-02T00:00:00Z',
            },
          ]),
        ]),
      );

      const repository = { id: 'repo-1' } as Repository;
      const saved = await service.syncIssues(repository, 'acme', 'widgets');

      expect(saved).toHaveLength(2);
      expect(saved.map((i) => i.title)).toEqual(['Issue one', 'Issue three']);
      expect(issueRepo.save).toHaveBeenCalledTimes(2);
    });

    it('never persists issues that carry pull_request', async () => {
      octokit.paginate.iterator.mockReturnValue(
        pagesThenThrow([
          issuePage([{ id: 9, number: 9, pull_request: { url: 'x' } }]),
        ]),
      );

      const saved = await service.syncIssues(
        { id: 'repo-1' } as Repository,
        'acme',
        'widgets',
      );
      expect(saved).toHaveLength(0);
      expect(issueRepo.save).not.toHaveBeenCalled();
    });

    it('keeps issues already persisted before a mid-pagination failure, and reports a resumable error', async () => {
      const rateLimitError = Object.assign(
        new Error('API rate limit exceeded'),
        {
          status: 429,
        },
      );

      octokit.paginate.iterator.mockReturnValue(
        pagesThenThrow(
          [
            issuePage([
              { id: 1, number: 1, title: 'Persisted before failure' },
            ]),
          ],
          rateLimitError,
        ),
      );

      await expect(
        service.syncIssues({ id: 'repo-1' } as Repository, 'acme', 'widgets'),
      ).rejects.toThrow(GithubSyncInterruptedError);

      // The page fetched before the 429 is durably saved, not discarded.
      expect(issueRepo.save).toHaveBeenCalledTimes(1);
      expect(issueRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Persisted before failure' }),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('interrupted'),
      );
    });

    it('the thrown error clearly reports how many issues survived and that re-running is safe', async () => {
      const networkError = new Error('ECONNRESET');
      octokit.paginate.iterator.mockReturnValue(
        pagesThenThrow(
          [
            issuePage([{ id: 1, number: 1 }]),
            issuePage([{ id: 2, number: 2 }]),
          ],
          networkError,
        ),
      );

      let caught: GithubSyncInterruptedError | undefined;
      try {
        await service.syncIssues(
          { id: 'repo-1' } as Repository,
          'acme',
          'widgets',
        );
      } catch (err) {
        caught = err as GithubSyncInterruptedError;
      }

      expect(caught).toBeInstanceOf(GithubSyncInterruptedError);
      expect(caught?.issuesSyncedBeforeFailure).toBe(2);
      expect(caught?.owner).toBe('acme');
      expect(caught?.repo).toBe('widgets');
      expect(caught?.message).toMatch(/safe to re-run|re-run the sync/i);
    });
  });

  describe('upsertIssueRecord — optimistic concurrency (#24)', () => {
    it('applies a write when there is no existing record', async () => {
      issueRepo.findOne.mockResolvedValue(null);
      const { applied } = await service.upsertIssueRecord('repo-1', {
        id: 1,
        number: 1,
        title: 'New issue',
        state: 'open',
        html_url: 'x',
        updated_at: '2026-01-01T00:00:00Z',
      });
      expect(applied).toBe(true);
      expect(issueRepo.save).toHaveBeenCalled();
    });

    it('rejects a stale write that arrives after a newer one, regardless of call order (sync after webhook)', async () => {
      const newer = new Date('2026-01-05T00:00:00Z');
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-1',
        githubIssueId: '1',
        githubUpdatedAt: newer,
      });

      const { applied } = await service.upsertIssueRecord('repo-1', {
        id: 1,
        number: 1,
        title: 'Stale sync payload',
        state: 'open',
        html_url: 'x',
        updated_at: '2026-01-01T00:00:00Z', // older than `newer`
      });

      expect(applied).toBe(false);
      expect(issueRepo.save).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping stale write'),
      );
    });

    it('rejects a stale write that arrives after a newer one, regardless of call order (webhook after sync)', async () => {
      const newer = new Date('2026-02-01T00:00:00Z');
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-1',
        githubIssueId: '1',
        githubUpdatedAt: newer,
      });

      const { applied } = await service.upsertIssueRecord('repo-1', {
        id: 1,
        number: 1,
        title: 'Delayed stale webhook retry',
        state: 'open',
        html_url: 'x',
        updated_at: '2026-01-15T00:00:00Z', // older than `newer`
      });

      expect(applied).toBe(false);
      expect(issueRepo.save).not.toHaveBeenCalled();
    });

    it('applies a write that is newer than the stored record', async () => {
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-1',
        githubIssueId: '1',
        githubUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const { applied } = await service.upsertIssueRecord('repo-1', {
        id: 1,
        number: 1,
        title: 'Fresh update',
        state: 'closed',
        html_url: 'x',
        updated_at: '2026-01-10T00:00:00Z',
      });

      expect(applied).toBe(true);
      expect(issueRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Fresh update', state: 'closed' }),
      );
    });
  });

  describe('syncRepository — rate-limit budget logging (#24)', () => {
    it('logs rate-limit status before and after a sync', async () => {
      octokit.repos.get.mockResolvedValue({
        data: {
          id: 42,
          owner: { login: 'acme' },
          name: 'widgets',
          full_name: 'acme/widgets',
          default_branch: 'main',
          private: false,
        },
      });
      octokit.paginate.iterator.mockReturnValue(
        pagesThenThrow([issuePage([])]),
      );

      await service.syncRepository('acme', 'widgets');

      const rateLimitLogs = (logSpy.mock.calls as unknown[][])
        .map((call) => String(call[0]))
        .filter((msg) => msg.includes('rate-limit'));
      expect(rateLimitLogs.some((m) => m.includes('before'))).toBe(true);
      expect(rateLimitLogs.some((m) => m.includes('after'))).toBe(true);
      expect(octokit.rest.rateLimit.get).toHaveBeenCalledTimes(2);
    });

    it('does not let a rate-limit status lookup failure block the sync itself', async () => {
      octokit.rest.rateLimit.get.mockRejectedValue(new Error('unreachable'));
      octokit.repos.get.mockResolvedValue({
        data: {
          id: 42,
          owner: { login: 'acme' },
          name: 'widgets',
          full_name: 'acme/widgets',
          default_branch: 'main',
          private: false,
        },
      });
      octokit.paginate.iterator.mockReturnValue(
        pagesThenThrow([issuePage([])]),
      );

      await expect(
        service.syncRepository('acme', 'widgets'),
      ).resolves.toBeDefined();
    });
  });
});
