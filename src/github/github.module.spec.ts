import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { compileFeatureModule } from '../../test/helpers/module-test.helpers';
import { RepoScopeGuard } from '../auth/guards/repo-scope.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BountiesService } from '../bounties/bounties.service';
import {
  Bounty,
  Issue,
  Repository,
  User,
  WebhookEvent,
} from '../common/entities';
import { GithubSyncService } from './github-sync.service';
import { GithubWebhooksController } from './github-webhooks.controller';
import { GithubWebhooksService } from './github-webhooks.service';
import { GithubController } from './github.controller';
import { GithubModule } from './github.module';
import { GITHUB_OCTOKIT } from './octokit.provider';

describe('GithubModule (#837)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileFeatureModule(GithubModule);
  });

  afterAll(() => moduleRef.close());

  it.each([
    GithubSyncService,
    GithubWebhooksService,
    GithubController,
    GithubWebhooksController,
  ])('resolves %p', (token) => {
    expect(moduleRef.get(token)).toBeInstanceOf(token);
  });

  it('provides the shared Octokit client', () => {
    expect(moduleRef.get(GITHUB_OCTOKIT)).toBeDefined();
  });

  it('receives BountiesService from the imported BountiesModule', () => {
    expect(moduleRef.get(BountiesService, { strict: false })).toBeInstanceOf(
      BountiesService,
    );
  });

  it.each([Repository, Issue, Bounty, WebhookEvent, User])(
    'registers the %p repository',
    (entity) => {
      expect(moduleRef.get(getRepositoryToken(entity))).toBeDefined();
    },
  );

  // POST /github/sync is restricted by role and by repository maintainer
  // (#312); both guards are instantiated in this module's scope.
  it.each([RolesGuard, RepoScopeGuard])(
    'instantiates the %p enhancer in this module',
    (enhancer) => {
      expect(
        moduleRef.select(GithubModule).get(enhancer, { strict: true }),
      ).toBeInstanceOf(enhancer);
    },
  );
});
