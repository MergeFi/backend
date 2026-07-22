import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Octokit } from '@octokit/rest';
import { Repository as TypeOrmRepository } from 'typeorm';
import { Issue, Repository } from '../common/entities';
import { GITHUB_OCTOKIT } from './octokit.provider';

const MAINTENANCE_LABELS = ['maintenance', 'dependencies', 'chore', 'docs'];

/**
 * Shape shared by a REST `issues.listForRepo` item and an `issues` webhook
 * payload's `issue` object — both are GitHub's Issue resource, so the same
 * guarded upsert (see upsertIssueRecord) can accept either directly.
 */
export interface RawGithubIssue {
  id: number | string;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  labels?: Array<string | { name?: string | null }>;
  html_url: string;
  user?: { login?: string | null } | null;
  closed_at?: string | null;
  updated_at: string;
  pull_request?: unknown;
}

/**
 * Thrown when a sync is interrupted (e.g. rate-limit retries exhausted,
 * or a non-retryable error) partway through. Distinct from a generic Error
 * so callers/monitoring can tell "some issues may be missing, re-run this"
 * apart from a silent partial success — see #24. Re-running syncRepository/
 * syncIssues is always safe: every issue already persisted is skipped or
 * refreshed idempotently by upsertIssueRecord, so no work is duplicated and
 * no permanent gap is left by resuming.
 */
export class GithubSyncInterruptedError extends Error {
  constructor(
    public readonly owner: string,
    public readonly repo: string,
    public readonly issuesSyncedBeforeFailure: number,
    public readonly cause: Error,
  ) {
    super(
      `GitHub sync for ${owner}/${repo} was interrupted after persisting ` +
        `${issuesSyncedBeforeFailure} issue(s): ${cause.message}. ` +
        `Already-synced issues are safe; re-run the sync to resume — ` +
        `upserts are idempotent so no work will be duplicated.`,
    );
    this.name = 'GithubSyncInterruptedError';
  }
}

/**
 * Imports repositories, issues, and PR metadata from the GitHub REST API via
 * Octokit. Uses a static GITHUB_API_TOKEN for now (personal access token or
 * GitHub App installation token).
 *
 * The Octokit client (injected via GITHUB_OCTOKIT, see octokit.provider.ts)
 * is configured with retry + throttling plugins so primary/secondary rate
 * limits and transient 5xx/network errors back off and retry automatically
 * up to a hard ceiling, rather than throwing straight into syncIssues.
 *
 * TODO: move to a GitHub App installation-token flow (one token per
 * installation, refreshed automatically) instead of a single static token so
 * multiple orgs can be synced with least-privilege scopes.
 */
@Injectable()
export class GithubSyncService {
  private readonly logger = new Logger(GithubSyncService.name);

  constructor(
    @Inject(GITHUB_OCTOKIT) private readonly octokit: Octokit,
    @InjectRepository(Repository)
    private readonly repositoryRepo: TypeOrmRepository<Repository>,
    @InjectRepository(Issue)
    private readonly issueRepo: TypeOrmRepository<Issue>,
  ) {}

  /** Imports (or refreshes) a single repository and all of its open+closed issues. */
  async syncRepository(owner: string, repo: string): Promise<Repository> {
    await this.logRateLimitStatus(`before ${owner}/${repo}`);

    const { data: repoData } = await this.octokit.repos.get({ owner, repo });

    let repository = await this.repositoryRepo.findOne({
      where: { githubRepoId: String(repoData.id) },
    });

    const attrs = {
      githubRepoId: String(repoData.id),
      owner: repoData.owner.login,
      name: repoData.name,
      fullName: repoData.full_name,
      description: repoData.description ?? null,
      defaultBranch: repoData.default_branch,
      private: repoData.private,
      primaryLanguage: repoData.language ?? null,
      stargazersCount: repoData.stargazers_count ?? 0,
      lastSyncedAt: new Date(),
    };

    repository = repository
      ? this.repositoryRepo.merge(repository, attrs)
      : this.repositoryRepo.create(attrs);
    repository = await this.repositoryRepo.save(repository);

    try {
      await this.syncIssues(repository, owner, repo);
    } finally {
      await this.logRateLimitStatus(`after ${owner}/${repo}`);
    }
    return repository;
  }

  /**
   * Pages through every issue for a repo, persisting each page as soon as
   * it's fetched (rather than collecting the whole paginated result first)
   * so a rate-limit/network failure on a later page doesn't discard the
   * issues already fetched — those stay durably saved, and re-running the
   * sync resumes via the idempotent upsert below rather than starting over.
   */
  async syncIssues(
    repository: Repository,
    owner: string,
    repo: string,
  ): Promise<Issue[]> {
    const saved: Issue[] = [];
    let pagesFetched = 0;

    try {
      for await (const response of this.octokit.paginate.iterator(
        this.octokit.issues.listForRepo,
        { owner, repo, state: 'all', per_page: 100 },
      )) {
        pagesFetched += 1;
        for (const raw of response.data as RawGithubIssue[]) {
          // Octokit returns PRs in the issues list too; skip those.
          if (raw.pull_request) continue;

          const { issue, applied } = await this.upsertIssueRecord(
            repository.id,
            raw,
          );
          if (applied) saved.push(issue);
        }
      }
    } catch (err) {
      const cause = err as Error;
      this.logger.error(
        `GitHub sync interrupted for ${owner}/${repo} after ${pagesFetched} ` +
          `page(s) / ${saved.length} issue(s) persisted: ${cause.message}`,
      );
      throw new GithubSyncInterruptedError(owner, repo, saved.length, cause);
    }

    this.logger.log(`Synced ${saved.length} issues for ${owner}/${repo}`);
    return saved;
  }

  /**
   * Upserts a single issue, guarded by GitHub's own `updated_at`: if the
   * locally stored issue's `githubUpdatedAt` is already newer than the
   * incoming data, the write is skipped (`applied: false`) rather than
   * overwriting fresher data with stale data. Called by syncIssues for every
   * page fetched from the REST API, and by GithubWebhooksService for
   * `issues` webhook events — both write paths go through the same guard,
   * so whichever one has the freshest GitHub-side timestamp always wins
   * regardless of which one happens to run, or commit, second (#24).
   */
  async upsertIssueRecord(
    repositoryId: string,
    raw: RawGithubIssue,
  ): Promise<{ issue: Issue; applied: boolean }> {
    const githubIssueId = String(raw.id);
    const incomingUpdatedAt = new Date(raw.updated_at);

    const existing = await this.issueRepo.findOne({
      where: { githubIssueId },
    });

    if (
      existing?.githubUpdatedAt &&
      existing.githubUpdatedAt.getTime() > incomingUpdatedAt.getTime()
    ) {
      this.logger.warn(
        `Skipping stale write for issue ${githubIssueId} (#${raw.number}): ` +
          `incoming updated_at ${raw.updated_at} is older than the stored ` +
          `${existing.githubUpdatedAt.toISOString()}`,
      );
      return { issue: existing, applied: false };
    }

    const labels = (raw.labels ?? []).map((l) =>
      typeof l === 'string' ? l : (l.name ?? ''),
    );
    const attrs = {
      repositoryId,
      githubIssueId,
      number: raw.number,
      title: raw.title,
      body: raw.body ?? null,
      state: raw.state as 'open' | 'closed',
      labels,
      githubUrl: raw.html_url,
      authorLogin: raw.user?.login ?? null,
      isMaintenanceType: labels.some((l) =>
        MAINTENANCE_LABELS.includes(l.toLowerCase()),
      ),
      closedAt: raw.closed_at ? new Date(raw.closed_at) : null,
      githubUpdatedAt: incomingUpdatedAt,
    };

    const issue = existing
      ? this.issueRepo.merge(existing, attrs)
      : this.issueRepo.create(attrs);
    return { issue: await this.issueRepo.save(issue), applied: true };
  }

  async findRepositoryByGithubId(
    githubRepoId: string,
  ): Promise<Repository | null> {
    return this.repositoryRepo.findOne({ where: { githubRepoId } });
  }

  /** Fetches a single PR's merge status directly from the API (used by webhook fallback verification). */
  async getPullRequest(owner: string, repo: string, pullNumber: number) {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return data;
  }

  async findIssueByGithubId(githubIssueId: string): Promise<Issue> {
    const issue = await this.issueRepo.findOne({ where: { githubIssueId } });
    if (!issue)
      throw new NotFoundException(`Issue ${githubIssueId} not tracked`);
    return issue;
  }

  async findIssueByRepoAndNumber(
    repositoryId: string,
    number: number,
  ): Promise<Issue | null> {
    return this.issueRepo.findOne({ where: { repositoryId, number } });
  }

  /**
   * Logs remaining/limit for the core REST rate-limit budget around large
   * sync operations (#24), so a mid-sync rate-limit interruption shows up as
   * an obviously-low "before" number in logs rather than a mystery failure.
   * Best-effort: a failure to fetch rate-limit status never blocks the sync.
   */
  private async logRateLimitStatus(label: string): Promise<void> {
    try {
      const { data } = await this.octokit.rest.rateLimit.get();
      const { limit, remaining, reset } = data.resources.core;
      this.logger.log(
        `[rate-limit ${label}] core: ${remaining}/${limit} remaining, ` +
          `resets at ${new Date(reset * 1000).toISOString()}`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to fetch rate-limit status (${label}): ${(err as Error).message}`,
      );
    }
  }
}
