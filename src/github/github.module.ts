import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bounty, Issue, Repository, WebhookEvent } from '../common/entities';
import { GithubSyncService } from './github-sync.service';
import { GithubController } from './github.controller';
import { GithubWebhooksService } from './github-webhooks.service';
import { GithubWebhooksController } from './github-webhooks.controller';
import { BountiesModule } from '../bounties/bounties.module';
import { githubOctokitProvider } from './octokit.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([Repository, Issue, Bounty, WebhookEvent]),
    BountiesModule,
  ],
  controllers: [GithubController, GithubWebhooksController],
  providers: [githubOctokitProvider, GithubSyncService, GithubWebhooksService],
  exports: [GithubSyncService],
})
export class GithubModule {}
