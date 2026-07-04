import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Octokit } from '@octokit/rest';
import { Repository as TypeOrmRepository } from 'typeorm';
import { Issue, Repository } from '../common/entities';
import { AppConfig } from '../config/configuration';

/**
 * Imports repositories, issues, and PR metadata from the GitHub REST API via
 * Octokit. Uses a static GITHUB_API_TOKEN for now (personal access token or
 * GitHub App installation token).
 *
 * TODO: move to a GitHub App installation-token flow (one token per
 * installation, refreshed automatically) instead of a single static token so
 * multiple orgs can be synced with least-privilege scopes.
 */
@Injectable()
export class GithubSyncService {
  private readonly logger = new Logger(GithubSyncService.name);
  private readonly octokit: Octokit;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    @InjectRepository(Repository)
    private readonly repositoryRepo: TypeOrmRepository<Repository>,
    @InjectRepository(Issue)
    private readonly issueRepo: TypeOrmRepository<Issue>,
  ) {
    const token = this.configService.get('github', { infer: true }).apiToken;
    this.octokit = new Octokit(token ? { auth: token } : {});
  }

  /** Imports (or refreshes) a single repository and all of its open+closed issues. */
  async syncRepository(owner: string, repo: string): Promise<Repository> {
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

    await this.syncIssues(repository, owner, repo);
    return repository;
  }

  async syncIssues(
    repository: Repository,
    owner: string,
    repo: string,
  ): Promise<Issue[]> {
    const issues = await this.octokit.paginate(
      this.octokit.issues.listForRepo,
      {
        owner,
        repo,
        state: 'all',
        per_page: 100,
      },
    );

    const saved: Issue[] = [];
    for (const raw of issues) {
      // Octokit returns PRs in the issues list too; skip those.
      if ('pull_request' in raw && raw.pull_request) continue;

      let issue = await this.issueRepo.findOne({
        where: { githubIssueId: String(raw.id) },
      });

      const labels = (raw.labels ?? []).map((l) =>
        typeof l === 'string' ? l : (l.name ?? ''),
      );
      const attrs = {
        repositoryId: repository.id,
        githubIssueId: String(raw.id),
        number: raw.number,
        title: raw.title,
        body: raw.body ?? null,
        state: raw.state as 'open' | 'closed',
        labels,
        githubUrl: raw.html_url,
        authorLogin: raw.user?.login ?? null,
        isMaintenanceType: labels.some((l) =>
          ['maintenance', 'dependencies', 'chore', 'docs'].includes(
            l.toLowerCase(),
          ),
        ),
        closedAt: raw.closed_at ? new Date(raw.closed_at) : null,
      };

      issue = issue
        ? this.issueRepo.merge(issue, attrs)
        : this.issueRepo.create(attrs);
      saved.push(await this.issueRepo.save(issue));
    }

    this.logger.log(`Synced ${saved.length} issues for ${owner}/${repo}`);
    return saved;
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
}
