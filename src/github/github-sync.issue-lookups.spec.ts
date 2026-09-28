import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Octokit } from '@octokit/rest';
import { GithubSyncService } from './github-sync.service';
import { GITHUB_OCTOKIT } from './octokit.provider';
import { Issue, Repository } from '../common/entities';
import { IssueState } from '../common/enums';

/**
 * The issue lookups on GithubSyncService had no callers and no tests (#311):
 * every path resolved issues with its own inline query instead. These tests
 * cover the lookups themselves, including the NotFoundException branch that
 * was previously unexercised.
 */
describe('GithubSyncService — issue lookups (#311)', () => {
  let service: GithubSyncService;
  let issueRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; merge: jest.Mock };
  let repositoryRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    issueRepo = {
      findOne: jest.fn(),
      create: jest.fn((data: Partial<Issue>) => data),
      save: jest.fn((data: Partial<Issue>) => Promise.resolve(data)),
      merge: jest.fn((_entity: Partial<Issue>, data: Partial<Issue>) => data),
    };
    repositoryRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'repo-uuid-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubSyncService,
        {
          provide: ConfigService,
          useValue: { get: () => ({ githubToken: 'token' }) },
        },
        { provide: getRepositoryToken(Issue), useValue: issueRepo },
        { provide: getRepositoryToken(Repository), useValue: repositoryRepo },
        { provide: GITHUB_OCTOKIT, useValue: { octokit: {} as unknown as Octokit } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(GithubSyncService);
  });

  describe('findIssueByGithubId', () => {
    it('returns the tracked issue', async () => {
      const issue = { id: 'issue-1', githubIssueId: '555' } as Issue;
      issueRepo.findOne.mockResolvedValue(issue);

      await expect(service.findIssueByGithubId('555')).resolves.toBe(issue);
      expect(issueRepo.findOne).toHaveBeenCalledWith({ where: { githubIssueId: '555' } });
    });

    it('throws NotFoundException when the issue is not tracked', async () => {
      issueRepo.findOne.mockResolvedValue(null);

      await expect(service.findIssueByGithubId('999')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.findIssueByGithubId('999')).rejects.toThrow(
        'Issue 999 not tracked',
      );
    });
  });

  describe('findIssueByGithubIdOrNull', () => {
    it('returns the issue when tracked', async () => {
      const issue = { id: 'issue-1' } as Issue;
      issueRepo.findOne.mockResolvedValue(issue);
      await expect(service.findIssueByGithubIdOrNull('555')).resolves.toBe(issue);
    });

    it('returns null instead of throwing for an untracked issue', async () => {
      issueRepo.findOne.mockResolvedValue(null);
      await expect(service.findIssueByGithubIdOrNull('999')).resolves.toBeNull();
    });
  });

  describe('findIssueByRepoAndNumber', () => {
    it('resolves an issue by repository id and number', async () => {
      const issue = { id: 'issue-1', number: 42 } as Issue;
      issueRepo.findOne.mockResolvedValue(issue);

      await expect(
        service.findIssueByRepoAndNumber('repo-uuid-1', 42),
      ).resolves.toBe(issue);
      expect(issueRepo.findOne).toHaveBeenCalledWith({
        where: { repositoryId: 'repo-uuid-1', number: 42 },
      });
    });

    it('returns null when the repository has no such issue', async () => {
      issueRepo.findOne.mockResolvedValue(null);
      await expect(
        service.findIssueByRepoAndNumber('repo-uuid-1', 99),
      ).resolves.toBeNull();
    });

    it('loads requested relations so a caller can use them', async () => {
      const issue = { id: 'issue-1', bounty: { id: 'bounty-1' } } as unknown as Issue;
      issueRepo.findOne.mockResolvedValue(issue);

      await service.findIssueByRepoAndNumber('repo-uuid-1', 42, {
        repository: true,
        bounty: true,
      });

      expect(issueRepo.findOne).toHaveBeenCalledWith({
        where: { repositoryId: 'repo-uuid-1', number: 42 },
        relations: { repository: true, bounty: true },
      });
    });
  });

  describe('upsertIssueRecord reuses the shared lookup (#311)', () => {
    const rawIssue = {
      id: 555,
      number: 42,
      title: 'A tracked issue',
      state: 'open' as IssueState,
      html_url: 'https://github.com/acme/repo/issues/42',
      updated_at: '2026-01-01T00:00:00Z',
      labels: [],
      user: { login: 'octocat' },
    };

    it('skips a stale write using the shared lookup', async () => {
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-1',
        githubIssueId: '555',
        githubUpdatedAt: new Date('2026-06-01T00:00:00Z'),
      });

      const result = await service.upsertIssueRecord('repo-uuid-1', rawIssue);

      expect(result.applied).toBe(false);
      expect(issueRepo.save).not.toHaveBeenCalled();
    });

    it('applies a newer update', async () => {
      issueRepo.findOne.mockResolvedValue({
        id: 'issue-1',
        githubIssueId: '555',
        githubUpdatedAt: new Date('2025-01-01T00:00:00Z'),
      });

      const result = await service.upsertIssueRecord('repo-uuid-1', rawIssue);

      expect(result.applied).toBe(true);
      expect(issueRepo.save).toHaveBeenCalled();
    });
  });
});
