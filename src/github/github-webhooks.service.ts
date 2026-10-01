import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, WebhookEvent } from '../common/entities';
import { BountyStatus, WebhookEventStatus } from '../common/enums';
import { AppConfig } from '../config/configuration';
import { verifyGithubSignature } from './webhook-signature.util';
import { BountiesService } from '../bounties/bounties.service';
import { GithubSyncService, RawGithubIssue } from './github-sync.service';
import {
  validateIssuesEventPayload,
  validatePullRequestPayload,
  WebhookPayloadValidationError,
} from './github-webhook-payload.util';

export interface GithubPullRequestPayload {
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

export interface GithubIssuesEventPayload {
  action: string;
  issue: RawGithubIssue;
  repository: { id: number; full_name: string };
}

/** Matches "Fixes #123", "Closes #45", "Resolves owner/repo#45" etc. in a PR body. */
const CLOSING_KEYWORD_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s*(?<repo>[\w.-]+\/[\w.-]+)?#(?<number>\d+)/gi;

/**
 * Matches a continuation of a closing-keyword list — the `, #22` in
 * "Closes #10, #22, #33", which GitHub documents as linking every issue in a
 * comma-separated list introduced by a single keyword (#309). Anchored so it
 * only ever matches immediately after the previous reference (or a comma).
 */
const CLOSING_KEYWORD_CONTINUATION_RE =
  /^\s*,\s*(?<repo>[\w.-]+\/[\w.-]+)?#(?<number>\d+)/;

/**
 * The outcome of processing one issue number linked from a merged PR's
 * body — tracked per-issue rather than collapsing a whole PR's several
 * linked bounties into one pass/fail, so a failure on one doesn't hide
 * what happened to the others (#47).
 */
interface LinkedIssueOutcome {
  issueNumber: number;
  outcome: 'succeeded' | 'skipped' | 'failed';
  error?: string;
}

/**
 * What each pull_request branch contributes to {@link processLinkedIssues}:
 * the bounty status it acts on, and the action to run. Resolving the issue,
 * loading its bounty, and recording the per-issue outcome are identical across
 * branches and live in the helper (#316).
 */
interface LinkedIssueAction {
  /** Bounty status the branch acts on; anything else is skipped. */
  requiredStatus: BountyStatus;
  /** Runs before `action` when the bounty is in `requiredStatus`. */
  preAction?: (bounty: Bounty) => Promise<void>;
  action: (bounty: Bounty) => Promise<void>;
  /**
   * Act on a bounty that is not in `requiredStatus` too, skipping `preAction`.
   * The merged-PR branch settles a bounty in any state; the other two branch
   * flows must not act outside their own status.
   */
  alsoProcessOtherStatuses?: boolean;
}

@Injectable()
export class GithubWebhooksService {
  private readonly logger = new Logger(GithubWebhooksService.name);

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    @InjectRepository(WebhookEvent)
    private readonly webhookEventRepo: Repository<WebhookEvent>,
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
    // GitHub deliveries aren't ordered and may be delivered more than once —
    // an operator hitting "Redeliver" resends the same X-GitHub-Delivery id.
    // `webhook_events.deliveryId` is unique, so inserting the duplicate
    // threw a QueryFailedError that escaped handleEvent entirely and turned
    // every redelivery into a bare 500, which GitHub then keeps retrying
    // (#308). Short-circuit on the stored row instead.
    if (deliveryId) {
      const existing = await this.findByDeliveryId(deliveryId);
      if (existing) {
        this.logger.warn(
          `Ignoring duplicate webhook delivery ${deliveryId} — already recorded ` +
            `(status: ${existing.status})`,
        );
        return existing;
      }
    }

    let event: WebhookEvent;
    try {
      event = await this.webhookEventRepo.save(
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
    } catch (err) {
      // Two deliveries racing past the lookup above can still collide on the
      // unique index; the loser treats that as the benign duplicate it is
      // rather than a crash.
      if (deliveryId && this.isUniqueViolation(err)) {
        const raced = await this.findByDeliveryId(deliveryId);
        if (raced) {
          this.logger.warn(
            `Ignoring concurrently delivered webhook ${deliveryId} — already recorded`,
          );
          return raced;
        }
      }
      throw err;
    }

    if (!signatureValid) {
      this.logger.warn(
        `Rejected webhook delivery ${deliveryId} — invalid signature`,
      );
      return event;
    }

    try {
      if (eventType === 'pull_request') {
        const outcomes = await this.handlePullRequest(
          validatePullRequestPayload(payload),
        );
        this.applyPullRequestOutcomes(event, outcomes);
      } else {
        if (eventType === 'issues') {
          await this.handleIssueEvent(validateIssuesEventPayload(payload));
        }
        event.status = WebhookEventStatus.PROCESSED;
        event.processedAt = new Date();
      }
    } catch (err) {
      if (err instanceof WebhookPayloadValidationError) {
        // Distinct from a processing-logic failure (#28): the payload
        // never had a shape any handler could act on, so no business
        // logic ran at all — record that plainly rather than folding it
        // into the same FAILED bucket a real processing error uses.
        event.status = WebhookEventStatus.INVALID_PAYLOAD;
        event.error = err.message;
        this.logger.warn(
          `Rejected webhook delivery ${deliveryId} — invalid payload: ${event.error}`,
        );
      } else {
        event.status = WebhookEventStatus.FAILED;
        event.error = (err as Error).message;
        this.logger.error(
          `Failed to process webhook ${deliveryId}: ${event.error}`,
        );
      }
    }

    return this.webhookEventRepo.save(event);
  }

  /** The recorded row for a GitHub delivery id, or null when it is new. */
  private async findByDeliveryId(
    deliveryId: string,
  ): Promise<WebhookEvent | null> {
    return this.webhookEventRepo.findOne({ where: { deliveryId } });
  }

  /**
   * True for a Postgres unique-constraint violation (SQLSTATE 23505) — the
   * `deliveryId` unique index rejecting a duplicate delivery (#308).
   */
  private isUniqueViolation(err: unknown): boolean {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === '23505') {
      return true;
    }
    const driverCode = (
      err as { driverError?: { code?: unknown } } | null
    )?.driverError?.code;
    if (driverCode === '23505') {
      return true;
    }
    return /duplicate key value violates unique constraint/i.test(
      (err as { message?: unknown } | null)?.message
        ? String((err as { message: string }).message)
        : '',
    );
  }

  /**
   * Decides `event.status`/`event.error` from a merged PR's per-linked-
   * issue outcomes (#47) — a deliberate choice among the three the issue
   * names as options:
   *
   * `event.status` stays FAILED whenever at least one linked issue's
   * bounty processing failed, even if others succeeded. FAILED already
   * means "an operator should look at this," so keeping it doesn't lose
   * that signal — but `event.error` now lists every failure by issue
   * number (`#12: <message>; #56: <message>`) instead of only whichever
   * one happened to throw first and abort the old unguarded loop, so an
   * operator can see exactly which of the PR's several linked bounties
   * actually need attention without re-deriving it from the PR body and
   * bounty statuses by hand. A PR where every linked issue either
   * succeeded or had no bounty to process (skipped) is PROCESSED, same
   * as before this fix.
   */
  private applyPullRequestOutcomes(
    event: WebhookEvent,
    outcomes: LinkedIssueOutcome[],
  ): void {
    const failures = outcomes.filter((o) => o.outcome === 'failed');
    if (failures.length === 0) {
      event.status = WebhookEventStatus.PROCESSED;
      event.processedAt = new Date();
      return;
    }

    event.status = WebhookEventStatus.FAILED;
    event.error = failures
      .map((f) => `#${f.issueNumber}: ${f.error}`)
      .join('; ');
    this.logger.error(
      `Partial failure processing linked issues for a merged PR: ${event.error}`,
    );
  }

  private async handlePullRequest(
    payload: GithubPullRequestPayload,
  ): Promise<LinkedIssueOutcome[]> {
    // #310 — `edited` is routed the same as `opened`/`reopened`: a contributor
    // who opens a PR (or a draft) before writing the description only gets
    // the closing keyword in later, and GitHub delivers that as an `edited`
    // event. Without this, a bounty referenced only after the initial body
    // stays CLAIMED for the whole review window even though a real PR is open
    // against it. The handler is idempotent — it only touches bounties that
    // are still CLAIMED — so re-running it on every body edit is safe.
    if (
      payload.action === 'opened' ||
      payload.action === 'reopened' ||
      payload.action === 'edited'
    ) {
      return this.handlePullRequestOpened(payload);
    }

    if (payload.action === 'closed' && !payload.pull_request.merged) {
      return this.handlePullRequestClosedWithoutMerge(payload);
    }

    if (payload.action !== 'closed' || !payload.pull_request.merged) {
      return [];
    }

    // De-duplicated so a PR body referencing the same issue twice (e.g.
    // "Fixes #12. Also resolves #12 as discussed.") doesn't attempt to
    // process the same bounty twice in one event — the second call would
    // otherwise throw InvalidBountyTransitionError against the state the
    // first call just left it in, which is a benign, false-alarm failure
    // rather than a real one (#47).
    const issueNumbers = [
      ...new Set(
        this.extractLinkedIssueNumbers(
          payload.pull_request.body ?? '',
          payload.repository.full_name,
        ),
      ),
    ];
    if (issueNumbers.length === 0) {
      this.logger.warn(
        `PR #${payload.number} in ${payload.repository.full_name} merged but references no issue`,
      );
      return [];
    }

    // Each linked issue is processed in its own try/catch so one bounty's
    // failure — an invalid state transition, an escrow release failure,
    // a Soroban error — doesn't abort processing of every other bounty
    // linked from the same merged PR (#47).
    return this.processLinkedIssues(issueNumbers, payload, {
      // A PR merged from CLAIMED is first moved into review (idempotent), then
      // released; a bounty in any other state is released without the extra
      // step, matching the merged-PR branch's original behaviour (#47).
      requiredStatus: BountyStatus.CLAIMED,
      alsoProcessOtherStatuses: true,
      preAction: async (bounty) => {
        await this.bountiesService.markInReview(
          bounty.id,
          payload.pull_request.html_url,
          payload.pull_request.number,
        );
      },
      action: async (bounty) => {
        await this.bountiesService.markMergedAndRelease(bounty.id);
      },
    });
  }

  /**
   * Resolves every issue number linked from a pull_request body to its
   * tracked issue + bounty, applies that branch's guard and action, and returns
   * one outcome per issue so a single failure never hides the rest (#47).
   *
   * This is the single implementation shared by the merged-PR, PR-opened and
   * PR-closed-without-merge branches (#316) — before extraction the three
   * copies had already drifted, with the merged-PR branch skipping a
   * non-CLAIMED bounty where the others skipped on their own status.
   */
  private async processLinkedIssues(
    issueNumbers: number[],
    payload: GithubPullRequestPayload,
    {
      requiredStatus,
      action,
      preAction,
      alsoProcessOtherStatuses = false,
    }: LinkedIssueAction,
  ): Promise<LinkedIssueOutcome[]> {
    // Resolved once per event rather than per linked issue: a PR body naming
    // five issues would otherwise repeat the same repository lookup five times
    // (#311).
    const repository = await this.syncService.findRepositoryByGithubId(
      String(payload.repository.id),
    );

    const outcomes: LinkedIssueOutcome[] = [];
    for (const number of issueNumbers) {
      try {
        if (!repository) {
          outcomes.push({ issueNumber: number, outcome: 'skipped' });
          continue;
        }

        const issue = await this.syncService.findIssueByRepoAndNumber(
          repository.id,
          number,
          { repository: true, bounty: true },
        );
        if (!issue?.bounty) {
          outcomes.push({ issueNumber: number, outcome: 'skipped' });
          continue;
        }

        const bounty = await this.bountyRepo.findOne({
          where: { id: issue.bounty.id },
        });
        if (!bounty) {
          outcomes.push({ issueNumber: number, outcome: 'skipped' });
          continue;
        }

        if (bounty.status === requiredStatus) {
          if (preAction) await preAction(bounty);
          await action(bounty);
          outcomes.push({ issueNumber: number, outcome: 'succeeded' });
          continue;
        }

        if (!alsoProcessOtherStatuses) {
          outcomes.push({ issueNumber: number, outcome: 'skipped' });
          continue;
        }

        await action(bounty);
        outcomes.push({ issueNumber: number, outcome: 'succeeded' });
      } catch (err) {
        outcomes.push({
          issueNumber: number,
          outcome: 'failed',
          error: (err as Error).message,
        });
      }
    }
    return outcomes;
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

  /**
   * A closing keyword may optionally be qualified with an owner/repo, e.g.
   * "Fixes some-other-org/some-other-repo#45". When that qualifier is
   * present, it must match the webhook's own repository — otherwise the
   * reference is for an issue in a different repository entirely and must
   * not be resolved against this one (compared case-insensitively, as
   * GitHub owner/repo names are).
   *
   * GitHub also links every issue in a comma-separated list introduced by a
   * single keyword ("Closes #10, #22, #33"), so after each keyword match the
   * rest of that list is scanned forward too — continuing only while each
   * next token really is another `, #number` reference and stopping at the
   * first thing that isn't (#309). A comma-separated reference qualified with
   * a foreign owner/repo is skipped exactly like a standalone one.
   */
  private extractLinkedIssueNumbers(
    body: string,
    repoFullName: string,
  ): number[] {
    const isSameRepo = (repoQualifier?: string) =>
      !repoQualifier || repoQualifier.toLowerCase() === repoFullName.toLowerCase();

    const matches = [...body.matchAll(CLOSING_KEYWORD_RE)];
    const numbers: number[] = [];
    for (const m of matches) {
      const matchStart = m.index ?? 0;
      const repoQualifier = m.groups?.repo;
      if (!isSameRepo(repoQualifier)) {
        continue;
      }
      numbers.push(parseInt(m.groups!.number, 10));

      // Continue the comma-separated list that this keyword introduced.
      let cursor = matchStart + m[0].length;
      for (;;) {
        const rest = body.slice(cursor);
        const continuation = CLOSING_KEYWORD_CONTINUATION_RE.exec(rest);
        if (!continuation) {
          break;
        }
        cursor += continuation[0].length;
        if (!isSameRepo(continuation.groups?.repo)) {
          continue;
        }
        numbers.push(parseInt(continuation.groups!.number, 10));
      }
    }
    return numbers;
  }

  /**
   * When a PR is opened (or reopened) against a linked issue, move that
   * issue's bounty from CLAIMED to IN_REVIEW at the moment the PR actually
   * exists — rather than only synthetically at merge time (#168). Bounties
   * not in CLAIMED are left untouched (idempotent no-op), matching the
   * merged-PR branch's own `markInReview` guard.
   */
  private async handlePullRequestOpened(
    payload: GithubPullRequestPayload,
  ): Promise<LinkedIssueOutcome[]> {
    const issueNumbers = [
      ...new Set(
        this.extractLinkedIssueNumbers(
          payload.pull_request.body ?? '',
          payload.repository.full_name,
        ),
      ),
    ];
    if (issueNumbers.length === 0) {
      return [];
    }

    return this.processLinkedIssues(issueNumbers, payload, {
      requiredStatus: BountyStatus.CLAIMED,
      action: async (bounty) => {
        await this.bountiesService.markInReview(
          bounty.id,
          payload.pull_request.html_url,
          payload.pull_request.number,
        );
      },
    });
  }

  /**
   * When a PR is closed without merging, move linked bounties from
   * IN_REVIEW back to CLAIMED so they become claimable again.
   */
  private async handlePullRequestClosedWithoutMerge(
    payload: GithubPullRequestPayload,
  ): Promise<LinkedIssueOutcome[]> {
    const issueNumbers = [
      ...new Set(
        this.extractLinkedIssueNumbers(
          payload.pull_request.body ?? '',
          payload.repository.full_name,
        ),
      ),
    ];
    if (issueNumbers.length === 0) {
      return [];
    }

    return this.processLinkedIssues(issueNumbers, payload, {
      requiredStatus: BountyStatus.IN_REVIEW,
      action: async (bounty) => {
        await this.bountiesService.markPrClosedWithoutMerge(bounty.id);
      },
    });
  }
}
