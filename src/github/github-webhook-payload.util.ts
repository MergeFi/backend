import type { GithubIssuesEventPayload, GithubPullRequestPayload } from './github-webhooks.service';

/**
 * Thrown when an inbound webhook payload doesn't have the shape a handler
 * requires, before any business logic runs — kept as a distinct error type
 * from whatever a handler itself might throw (a bad state transition, a
 * Soroban failure, ...) so `GithubWebhooksService.handleEvent` can record
 * the two classes of failure distinctly on `WebhookEvent` (#28).
 */
export class WebhookPayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookPayloadValidationError';
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new WebhookPayloadValidationError(
      `"${path}" must be an object, got ${describe(value)}`,
    );
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new WebhookPayloadValidationError(
      `"${path}" must be a string, got ${describe(value)}`,
    );
  }
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WebhookPayloadValidationError(
      `"${path}" must be a finite number, got ${describe(value)}`,
    );
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new WebhookPayloadValidationError(
      `"${path}" must be a boolean, got ${describe(value)}`,
    );
  }
  return value;
}

function optionalString(
  value: unknown,
  path: string,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  return requireString(value, path);
}

/** Shared by every event-type validator: every webhook payload identifies a repository. */
function requireRepository(
  payload: Record<string, unknown>,
): { id: number; full_name: string } {
  const repository = requireRecord(payload.repository, 'repository');
  return {
    id: requireNumber(repository.id, 'repository.id'),
    full_name: requireString(repository.full_name, 'repository.full_name'),
  };
}

/**
 * Validates a `pull_request` event payload has the shape
 * `GithubWebhooksService.handlePullRequest` (and its opened/closed-without-
 * merge siblings) assumes, before any of that logic runs. Throws
 * `WebhookPayloadValidationError` describing exactly which field was wrong
 * or missing.
 */
export function validatePullRequestPayload(
  payload: unknown,
): GithubPullRequestPayload {
  const record = requireRecord(payload, 'payload');
  const action = requireString(record.action, 'action');
  const number = requireNumber(record.number, 'number');
  const pullRequest = requireRecord(record.pull_request, 'pull_request');
  const repository = requireRepository(record);

  return {
    action,
    number,
    pull_request: {
      html_url: requireString(pullRequest.html_url, 'pull_request.html_url'),
      number: requireNumber(pullRequest.number, 'pull_request.number'),
      merged: requireBoolean(pullRequest.merged, 'pull_request.merged'),
      body: optionalString(pullRequest.body, 'pull_request.body'),
      title: optionalString(pullRequest.title, 'pull_request.title') ?? undefined,
    },
    repository,
  };
}

/**
 * Validates an `issues` event payload has the shape
 * `GithubWebhooksService.handleIssueEvent` assumes. Only the fields that
 * handler and `GithubSyncService.upsertIssueRecord` actually read are
 * required; everything else on the real GitHub payload is ignored, matching
 * `RawGithubIssue`'s own optional fields.
 */
export function validateIssuesEventPayload(
  payload: unknown,
): GithubIssuesEventPayload {
  const record = requireRecord(payload, 'payload');
  const action = requireString(record.action, 'action');
  const issue = requireRecord(record.issue, 'issue');
  const repository = requireRepository(record);

  requireString(issue.title, 'issue.title');
  requireNumber(issue.number, 'issue.number');
  requireString(issue.state, 'issue.state');
  requireString(issue.updated_at, 'issue.updated_at');
  requireString(issue.html_url, 'issue.html_url');
  if (typeof issue.id !== 'number' && typeof issue.id !== 'string') {
    throw new WebhookPayloadValidationError(
      `"issue.id" must be a number or string, got ${describe(issue.id)}`,
    );
  }

  return {
    action,
    // Only the fields above are validated; the rest of RawGithubIssue's
    // (all-optional) shape is passed through as-is.
    issue: issue as unknown as GithubIssuesEventPayload['issue'],
    repository,
  };
}
