import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Octokit } from '@octokit/rest';
import { GithubSyncService } from './github-sync.service';
import { GITHUB_OCTOKIT } from './octokit.provider';
import { Issue, Repository } from '../common/entities';
import { IssueState } from '../common/enums';

/**
 * Incremental issue sync (#315).
 *
 * A repository that has already been synced must only request issues updated
 * since `lastSyncedAt`, using GitHub's `since` filter, instead of re-walking
 * its entire issue history on every periodic sync.
 */
describe('GithubSyncService — incremental issue sync (#315)', () => {
  let service: GithubSyncService;
  let listForRepo: jest.Mock;
  let issueRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    merge: jest.Mock;
  };

  const LAST_SYNCED_AT = new Date('2026-06-01T12:00:00.000Z');

  const repository = (lastSyncedAt: Date | null) =>
    ({
      id: 'repo-uuid-1',
      githubRepoId: '999',
      fullName: 'acme/repo',
      lastSyncedAt,
    }) as Repository;

  const rawIssue = (id: number, updatedAt: string) => ({
    id,
    number: id,
    title: `Issue ${id}`,
    state: 'open' as IssueState,
    html_url: `https://github.com/acme/repo/issues/${id}`,
    updated_at: updatedAt,
    labels: [],
    user: { login: 'octocat' },
  });

  beforeEach(async () => {
    listForRepo = jest.fn().mockResolvedValue({ data: [] });
    issueRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: Partial<Issue>) => data),
      save: jest.fn((data: Partial<Issue>) => Promise.resolve(data)),
      merge: jest.fn((_entity: Partial<Issue>, data: Partial<Issue>) => data),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubSyncService,
        {
          provide: ConfigService,
          useValue: { get: () => ({ githubToken: 'token' }) },
        },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
        {
          provide: getRepositoryToken(Repository),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((data: Partial<Repository>) => data),
            save: jest.fn((data: Partial<Repository>) => Promise.resolve(data)),
            merge: jest.fn((_e: Partial<Repository>, data: Partial<Repository>) => data),
          },
        },
        {
          provide: GITHUB_OCTOKIT,
          useValue: {
            octokit: { issues: { listForRepo } } as unknown as Octokit,
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(GithubSyncService);
  });

  it('sends since=lastSyncedAt on the first page of a re-sync', async () => {
    await service.syncIssues(repository(LAST_SYNCED_AT), 'acme', 'repo');

    expect(listForRepo).toHaveBeenCalledTimes(1);
    expect(listForRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'acme',
        repo: 'repo',
        page: 1,
        since: LAST_SYNCED_AT.toISOString(),
      }),
    );
  });

  it('omits since for a repository that has never been synced', async () => {
    await service.syncIssues(repository(null), 'acme', 'repo');

    const params = listForRepo.mock.calls[0][0];
    expect(params.since).toBeUndefined();
    expect(params).not.toHaveProperty('since');
  });

  it('omits since on later pages so pagination is not re-filtered', async () => {
    await service.syncIssues(repository(LAST_SYNCED_AT), 'acme', 'repo', 2);

    const params = listForRepo.mock.calls[0][0];
    expect(params.page).toBe(2);
    expect(params).not.toHaveProperty('since');
  });

  it('omits since when lastSyncedAt is not a usable Date', async () => {
    await service.syncIssues(
      { lastSyncedAt: '2026-06-01' } as unknown as Repository,
      'acme',
      'repo',
    );

    expect(listForRepo.mock.calls[0][0]).not.toHaveProperty('since');
  });

  it('still upserts only the issues GitHub returned', async () => {
    listForRepo.mockResolvedValue({
      data: [rawIssue(1, '2026-06-02T00:00:00Z'), rawIssue(2, '2026-06-03T00:00:00Z')],
    });

    const result = await service.syncIssues(
      repository(LAST_SYNCED_AT),
      'acme',
      'repo',
    );

    expect(result.saved).toHaveLength(2);
    expect(issueRepo.save).toHaveBeenCalledTimes(2);
  });

  it('skips pull requests GitHub includes in the issues list', async () => {
    listForRepo.mockResolvedValue({
      data: [
        { ...rawIssue(1, '2026-06-02T00:00:00Z'), pull_request: { url: 'x' } },
        rawIssue(2, '2026-06-03T00:00:00Z'),
      ],
    });

    const result = await service.syncIssues(
      repository(LAST_SYNCED_AT),
      'acme',
      'repo',
    );

    expect(result.saved).toHaveLength(1);
    expect(result.saved[0].number).toBe(2);
  });
});
