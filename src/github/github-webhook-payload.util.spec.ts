import {
  validatePullRequestPayload,
  validateIssuesEventPayload,
  WebhookPayloadValidationError,
} from './github-webhook-payload.util';

describe('github-webhook-payload.util', () => {
  const validRepo = {
    id: 123456,
    full_name: 'MergeFi/backend',
  };

  const validPullRequest = {
    html_url: 'https://github.com/MergeFi/backend/pull/42',
    number: 42,
    merged: false,
    body: 'Resolves #10',
    title: 'fix: address race condition',
  };

  const validIssue = {
    id: 98765,
    number: 10,
    title: 'Bug report',
    state: 'open',
    updated_at: '2026-10-13T12:00:00Z',
    html_url: 'https://github.com/MergeFi/backend/issues/10',
  };

  describe('validatePullRequestPayload', () => {
    it('accepts a minimal valid pull_request payload', () => {
      const payload = {
        action: 'opened',
        number: 42,
        pull_request: {
          html_url: 'https://github.com/MergeFi/backend/pull/42',
          number: 42,
          merged: false,
        },
        repository: validRepo,
      };

      const result = validatePullRequestPayload(payload);

      expect(result).toEqual({
        action: 'opened',
        number: 42,
        pull_request: {
          html_url: 'https://github.com/MergeFi/backend/pull/42',
          number: 42,
          merged: false,
          body: undefined,
          title: undefined,
        },
        repository: {
          id: 123456,
          full_name: 'MergeFi/backend',
        },
      });
    });

    it('accepts a full valid pull_request payload with title and body', () => {
      const payload = {
        action: 'closed',
        number: 42,
        pull_request: validPullRequest,
        repository: validRepo,
      };

      const result = validatePullRequestPayload(payload);

      expect(result.action).toBe('closed');
      expect(result.pull_request.title).toBe('fix: address race condition');
      expect(result.pull_request.body).toBe('Resolves #10');
      expect(result.pull_request.merged).toBe(false);
    });

    it('rejects top-level non-object payloads', () => {
      expect(() => validatePullRequestPayload(null)).toThrow(
        WebhookPayloadValidationError,
      );
      expect(() => validatePullRequestPayload('invalid-string')).toThrow(
        WebhookPayloadValidationError,
      );
      expect(() => validatePullRequestPayload([1, 2, 3])).toThrow(
        WebhookPayloadValidationError,
      );
      expect(() => validatePullRequestPayload(undefined)).toThrow(
        WebhookPayloadValidationError,
      );
    });

    it('rejects payload with missing or invalid action', () => {
      expect(() =>
        validatePullRequestPayload({
          number: 42,
          pull_request: validPullRequest,
          repository: validRepo,
        }),
      ).toThrow(WebhookPayloadValidationError);

      expect(() =>
        validatePullRequestPayload({
          action: 123,
          number: 42,
          pull_request: validPullRequest,
          repository: validRepo,
        }),
      ).toThrow('"action" must be a string, got number');
    });

    it('rejects payload with missing or non-finite number', () => {
      expect(() =>
        validatePullRequestPayload({
          action: 'opened',
          pull_request: validPullRequest,
          repository: validRepo,
        }),
      ).toThrow(WebhookPayloadValidationError);

      expect(() =>
        validatePullRequestPayload({
          action: 'opened',
          number: '42',
          pull_request: validPullRequest,
          repository: validRepo,
        }),
      ).toThrow('"number" must be a finite number, got string');

      expect(() =>
        validatePullRequestPayload({
          action: 'opened',
          number: NaN,
          pull_request: validPullRequest,
          repository: validRepo,
        }),
      ).toThrow(WebhookPayloadValidationError);
    });

    it('rejects payload with invalid pull_request object or properties', () => {
      expect(() =>
        validatePullRequestPayload({
          action: 'opened',
          number: 42,
          pull_request: 'not-an-object',
          repository: validRepo,
        }),
      ).toThrow('"pull_request" must be an object, got string');

      expect(() =>
        validatePullRequestPayload({
          action: 'opened',
          number: 42,
          pull_request: { ...validPullRequest, html_url: 123 },
          repository: validRepo,
        }),
      ).toThrow('"pull_request.html_url" must be a string, got number');

      expect(() =>
        validatePullRequestPayload({
          action: 'opened',
          number: 42,
          pull_request: { ...validPullRequest, number: '42' },
          repository: validRepo,
        }),
      ).toThrow('"pull_request.number" must be a finite number, got string');

      expect(() =>
        validatePullRequestPayload({
          action: 'opened',
          number: 42,
          pull_request: { ...validPullRequest, merged: 'true' },
          repository: validRepo,
        }),
      ).toThrow('"pull_request.merged" must be a boolean, got string');

      expect(() =>
        validatePullRequestPayload({
          action: 'opened',
          number: 42,
          pull_request: { ...validPullRequest, body: 999 },
          repository: validRepo,
        }),
      ).toThrow('"pull_request.body" must be a string, got number');
    });

    it('rejects payload with invalid repository object or properties', () => {
      expect(() =>
        validatePullRequestPayload({
          action: 'opened',
          number: 42,
          pull_request: validPullRequest,
          repository: null,
        }),
      ).toThrow('"repository" must be an object, got null');

      expect(() =>
        validatePullRequestPayload({
          action: 'opened',
          number: 42,
          pull_request: validPullRequest,
          repository: { id: 'not-a-number', full_name: 'MergeFi/backend' },
        }),
      ).toThrow('"repository.id" must be a finite number, got string');

      expect(() =>
        validatePullRequestPayload({
          action: 'opened',
          number: 42,
          pull_request: validPullRequest,
          repository: { id: 123, full_name: 456 },
        }),
      ).toThrow('"repository.full_name" must be a string, got number');
    });
  });

  describe('validateIssuesEventPayload', () => {
    it('accepts a valid issues payload with numeric issue.id', () => {
      const payload = {
        action: 'opened',
        issue: validIssue,
        repository: validRepo,
      };

      const result = validateIssuesEventPayload(payload);

      expect(result.action).toBe('opened');
      expect(result.issue.id).toBe(98765);
      expect(result.issue.title).toBe('Bug report');
      expect(result.issue.number).toBe(10);
      expect(result.issue.state).toBe('open');
      expect(result.repository.id).toBe(123456);
      expect(result.repository.full_name).toBe('MergeFi/backend');
    });

    it('accepts a valid issues payload with string issue.id', () => {
      const payload = {
        action: 'labeled',
        issue: { ...validIssue, id: 'issue-node-id-123' },
        repository: validRepo,
      };

      const result = validateIssuesEventPayload(payload);

      expect(result.action).toBe('labeled');
      expect(result.issue.id).toBe('issue-node-id-123');
    });

    it('rejects top-level non-object payloads', () => {
      expect(() => validateIssuesEventPayload(null)).toThrow(
        WebhookPayloadValidationError,
      );
      expect(() => validateIssuesEventPayload('not-an-object')).toThrow(
        WebhookPayloadValidationError,
      );
    });

    it('rejects issues payload with invalid issue properties', () => {
      expect(() =>
        validateIssuesEventPayload({
          action: 'opened',
          issue: 'invalid',
          repository: validRepo,
        }),
      ).toThrow('"issue" must be an object, got string');

      expect(() =>
        validateIssuesEventPayload({
          action: 'opened',
          issue: { ...validIssue, title: null },
          repository: validRepo,
        }),
      ).toThrow('"issue.title" must be a string, got null');

      expect(() =>
        validateIssuesEventPayload({
          action: 'opened',
          issue: { ...validIssue, number: '10' },
          repository: validRepo,
        }),
      ).toThrow('"issue.number" must be a finite number, got string');

      expect(() =>
        validateIssuesEventPayload({
          action: 'opened',
          issue: { ...validIssue, state: 123 },
          repository: validRepo,
        }),
      ).toThrow('"issue.state" must be a string, got number');

      expect(() =>
        validateIssuesEventPayload({
          action: 'opened',
          issue: { ...validIssue, updated_at: 456 },
          repository: validRepo,
        }),
      ).toThrow('"issue.updated_at" must be a string, got number');

      expect(() =>
        validateIssuesEventPayload({
          action: 'opened',
          issue: { ...validIssue, html_url: false },
          repository: validRepo,
        }),
      ).toThrow('"issue.html_url" must be a string, got boolean');

      expect(() =>
        validateIssuesEventPayload({
          action: 'opened',
          issue: { ...validIssue, id: false },
          repository: validRepo,
        }),
      ).toThrow('"issue.id" must be a number or string, got boolean');
    });
  });

  describe('WebhookPayloadValidationError', () => {
    it('is an instance of Error with correct name and message', () => {
      const error = new WebhookPayloadValidationError('Invalid field');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('WebhookPayloadValidationError');
      expect(error.message).toBe('Invalid field');
    });
  });
});
