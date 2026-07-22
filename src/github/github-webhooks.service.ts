import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, Issue, WebhookEvent } from '../common/entities';
import { BountyStatus, WebhookEventStatus } from '../common/enums';
import { AppConfig } from '../config/configuration';
import { verifyGithubSignature } from './webhook-signature.util';
import { BountiesService } from '../bounties/bounties.service';
import { GithubSyncService, RawGithubIssue } from './github-sync.service';

interface GithubPullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    html_url: string;
    number: number;
    merged: boolean;
    body?: string | null;
    title?: string;
  };
  repository: { id: number; full_name: string };
}

interface GithubIssuesEventPayload {
  action: string;
  issue: RawGithubIssue;
  repository: { id: number; full_name: string };
}

/** Matches "Fixes #123", "Closes #45", "Resolves owner/repo#45" etc. in a PR body. */
const CLOSING_KEYWORD_RE =
  /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b\s*:?\s*(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi;

@Injectable()
export class GithubWebhooksService {
  private readonly logger = new Logger(GithubWebhooksService.name);

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    @InjectRepository(WebhookEvent)
    private readonly webhookEventRepo: Repository<WebhookEvent>,
    @InjectRepository(Issue) private readonly issueRepo: Repository<Issue>,
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    private readonly bountiesService: BountiesService,
    private readonly syncService: GithubSyncService,
  ) {}

  verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): boolean {
    const secret = this.configService.get('github', {
      infer: true,
    }).webhookSecret;
    return verifyGithubSignature(secret, rawBody, signatureHeader);
  }

  async handleEvent(
    eventType: string,
    deliveryId: string | undefined,
    payload: Record<string, unknown>,
    signatureValid: boolean,
  ): Promise<WebhookEvent> {
    const event = await this.webhookEventRepo.save(
      this.webhookEventRepo.create({
        eventType,
        deliveryId: deliveryId ?? null,
        payload,
        signatureValid,
        status: signatureValid
          ? WebhookEventStatus.RECEIVED
          : WebhookEventStatus.IGNORED,
      }),
    );

    if (!signatureValid) {
      this.logger.warn(
        `Rejected webhook delivery ${deliveryId} — invalid signature`,
      );
      return event;
    }

    try {
      if (eventType === 'pull_request') {
        await this.handlePullRequest(
          payload as unknown as GithubPullRequestPayload,
        );
      } else if (eventType === 'issues') {
        await this.handleIssueEvent(
          payload as unknown as GithubIssuesEventPayload,
        );
      }
      event.status = WebhookEventStatus.PROCESSED;
      event.processedAt = new Date();
    } catch (err) {
      event.status = WebhookEventStatus.FAILED;
      event.error = (err as Error).message;
      this.logger.error(
        `Failed to process webhook ${deliveryId}: ${event.error}`,
      );
    }

    return this.webhookEventRepo.save(event);
  }

  private async handlePullRequest(
    payload: GithubPullRequestPayload,
  ): Promise<void> {
    if (payload.action !== 'closed' || !payload.pull_request.merged) {
      return;
    }

    const issueNumbers = this.extractLinkedIssueNumbers(
      payload.pull_request.body ?? '',
    );
    if (issueNumbers.length === 0) {
      this.logger.warn(
        `PR #${payload.number} in ${payload.repository.full_name} merged but references no issue`,
      );
      return;
    }

    for (const number of issueNumbers) {
      const issue = await this.issueRepo.findOne({
        where: {
          number,
          repository: { githubRepoId: String(payload.repository.id) },
        },
        relations: { repository: true, bounty: true },
      });
      if (!issue?.bounty) continue;

      // Mark in_review first if it hadn't been (idempotent no-op if already there).
      const bounty = await this.bountyRepo.findOne({
        where: { id: issue.bounty.id },
      });
      if (!bounty) continue;

      if (bounty.status === BountyStatus.CLAIMED) {
        await this.bountiesService.markInReview(
          bounty.id,
          payload.pull_request.html_url,
          payload.pull_request.number,
        );
      }
      await this.bountiesService.markMergedAndRelease(bounty.id);
    }
  }

  /**
   * Keeps a tracked issue's title/body/state/labels in sync with an
   * `issues` webhook event (opened/edited/closed/reopened/...), through the
   * same optimistic-concurrency-guarded upsert a full sync uses — see
   * GithubSyncService.upsertIssueRecord's doc comment for why this is the
   * one write path both sync and webhooks share (#24).
   */
  private async handleIssueEvent(
    payload: GithubIssuesEventPayload,
  ): Promise<void> {
    const repository = await this.syncService.findRepositoryByGithubId(
      String(payload.repository.id),
    );
    if (!repository) {
      this.logger.warn(
        `Ignoring "issues" webhook for untracked repository ${payload.repository.full_name}`,
      );
      return;
    }

    const { applied } = await this.syncService.upsertIssueRecord(
      repository.id,
      payload.issue,
    );
    if (!applied) {
      this.logger.log(
        `Webhook "issues" update for #${payload.issue.number} in ` +
          `${payload.repository.full_name} was stale relative to stored data; ignored`,
      );
    }
  }

  private extractLinkedIssueNumbers(body: string): number[] {
    const matches = [...body.matchAll(CLOSING_KEYWORD_RE)];
    return matches.map((m) => parseInt(m[3], 10));
  }
}
