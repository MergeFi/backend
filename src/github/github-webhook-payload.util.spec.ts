import {
  validatePullRequestPayload,
  validateIssuesEventPayload,
  WebhookPayloadValidationError,
} from './github-webhook-payload.util';

describe('github-webhook-payload.util', () => {
  describe('validatePullRequestPayload', () => {
    const validPayload = {
      action: 'opened',
      number: 42,
      pull_request: {
        html_url: 'https://github.com/org/repo/pull/42',
        number: 42,
        merged: false,
        title: 'Fix issue',
        body: 'Closes #10',
      },
      repository: {
        id: 123456,
        full_name: 'org/repo',
      },
    };

    it('accepts a minimal valid pull request payload', () => {
      const result = validatePullRequestPayload(validPayload);
      expect(result.action).toBe('opened');
      expect(result.number).toBe(42);
      expect(result.pull_request.html_url).toBe(
        'https://github.com/org/repo/pull/42',
      );
      expect(result.pull_request.merged).toBe(false);
      expect(result.repository.id).toBe(123456);
      expect(result.repository.full_name).toBe('org/repo');
    });

    it('throws when payload is not an object', () => {
      expect(() => validatePullRequestPayload(null)).toThrow(
        WebhookPayloadValidationError,
      );
      expect(() => validatePullRequestPayload('string')).toThrow(
        WebhookPayloadValidationError,
      );
    });

    it('throws when action is missing or wrong type', () => {
      const { action, ...missingAction } = validPayload;
      expect(() => validatePullRequestPayload(missingAction)).toThrow(
        WebhookPayloadValidationError,
      );
      expect(() =>
        validatePullRequestPayload({ ...validPayload, action: 123 }),
      ).toThrow(WebhookPayloadValidationError);
    });

    it('throws when number is missing or wrong type', () => {
      const { number, ...missingNumber } = validPayload;
      expect(() => validatePullRequestPayload(missingNumber)).toThrow(
        WebhookPayloadValidationError,
      );
      expect(() =>
        validatePullRequestPayload({ ...validPayload, number: '42' }),
      ).toThrow(WebhookPayloadValidationError);
    });

    it('throws when pull_request or its required fields are missing', () => {
      expect(() =>
        validatePullRequestPayload({ ...validPayload, pull_request: null }),
      ).toThrow(WebhookPayloadValidationError);

      const invalidPr = { ...validPayload.pull_request, merged: 'not-bool' };
      expect(() =>
        validatePullRequestPayload({ ...validPayload, pull_request: invalidPr }),
      ).toThrow(WebhookPayloadValidationError);
    });

    it('throws when repository or repository.id is missing', () => {
      expect(() =>
        validatePullRequestPayload({ ...validPayload, repository: null }),
      ).toThrow(WebhookPayloadValidationError);

      expect(() =>
        validatePullRequestPayload({
          ...validPayload,
          repository: { id: 'invalid', full_name: 'org/repo' },
        }),
      ).toThrow(WebhookPayloadValidationError);
    });
  });

  describe('validateIssuesEventPayload', () => {
    const validIssuePayload = {
      action: 'opened',
      issue: {
        id: 98765,
        number: 10,
        title: 'Bug report',
        state: 'open',
        updated_at: '2026-10-19T00:00:00Z',
        html_url: 'https://github.com/org/repo/issues/10',
      },
      repository: {
        id: 123456,
        full_name: 'org/repo',
      },
    };

    it('accepts a minimal valid issues event payload', () => {
      const result = validateIssuesEventPayload(validIssuePayload);
      expect(result.action).toBe('opened');
      expect(result.issue.id).toBe(98765);
      expect(result.issue.title).toBe('Bug report');
      expect(result.repository.full_name).toBe('org/repo');
    });

    it('accepts string issue.id', () => {
      const result = validateIssuesEventPayload({
        ...validIssuePayload,
        issue: { ...validIssuePayload.issue, id: '98765' },
      });
      expect(result.issue.id).toBe('98765');
    });

    it('throws when issue.id is not a string or number', () => {
      expect(() =>
        validateIssuesEventPayload({
          ...validIssuePayload,
          issue: { ...validIssuePayload.issue, id: true },
        }),
      ).toThrow(WebhookPayloadValidationError);
    });

    it('throws when required fields on issue are missing or wrong type', () => {
      expect(() =>
        validateIssuesEventPayload({
          ...validIssuePayload,
          issue: { ...validIssuePayload.issue, title: 123 },
        }),
      ).toThrow(WebhookPayloadValidationError);

      expect(() =>
        validateIssuesEventPayload({
          ...validIssuePayload,
          issue: { ...validIssuePayload.issue, state: null },
        }),
      ).toThrow(WebhookPayloadValidationError);
    });
  });
});
