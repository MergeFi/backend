import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Bounty,
  Issue,
  Repository,
  User,
  WebhookEvent,
} from '../common/entities';
import { GithubSyncService } from './github-sync.service';
import { GithubController } from './github.controller';
import { GithubWebhooksService } from './github-webhooks.service';
import { GithubWebhooksController } from './github-webhooks.controller';
import { BountiesModule } from '../bounties/bounties.module';
import { githubOctokitProvider } from './octokit.provider';

@Module({
  imports: [
    // See TeamsModule for why RolesGuard (used on GithubController) needs
    // User here too.
    TypeOrmModule.forFeature([Repository, Issue, Bounty, WebhookEvent, User]),
    BountiesModule,
  ],
  controllers: [GithubController, GithubWebhooksController],
  providers: [githubOctokitProvider, GithubSyncService, GithubWebhooksService],
  exports: [GithubSyncService],
})
export class GithubModule {}
