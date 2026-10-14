import {
  validatePullRequestPayload,
  validateIssuesEventPayload,
  WebhookPayloadValidationError,
} from './github-webhook-payload.util';

const validPR = {
  action: 'closed',
  number: 42,
  pull_request: {
    html_url: 'https://github.com/o/r/pull/42',
    number: 42,
    merged: true,
    body: 'fixes',
    title: 'the pr',
  },
  repository: { id: 1, full_name: 'o/r', html_url: 'https://github.com/o/r' },
};

const validIssue = {
  action: 'opened',
  issue: {
    number: 7,
    title: 'the issue',
    state: 'open',
    updated_at: '2024-01-01T00:00:00Z',
  },
  repository: { id: 1, full_name: 'o/r', html_url: 'https://github.com/o/r' },
};

describe('github-webhook-payload.util', () => {
  describe('validatePullRequestPayload', () => {
    it('accepts a valid pull_request payload', () => {
      const out = validatePullRequestPayload(validPR);
      expect(out.number).toBe(42);
      expect(out.pull_request.merged).toBe(true);
    });

    it('rejects a payload missing pull_request', () => {
      expect(() =>
        validatePullRequestPayload({ action: 'closed', number: 1 }),
      ).toThrow(WebhookPayloadValidationError);
    });

    it('rejects a non-boolean merged', () => {
      expect(() =>
        validatePullRequestPayload({
          ...validPR,
          pull_request: { ...validPR.pull_request, merged: 'yes' },
        }),
      ).toThrow(WebhookPayloadValidationError);
    });
  });

  describe('validateIssuesEventPayload', () => {
    it('accepts a valid issues payload', () => {
      const out = validateIssuesEventPayload(validIssue);
      expect(out.issue.number).toBe(7);
    });

    it('rejects a payload missing the issue record', () => {
      expect(() => validateIssuesEventPayload({ action: 'opened' })).toThrow(
        WebhookPayloadValidationError,
      );
    });

    it('rejects a non-string issue.state', () => {
      expect(() =>
        validateIssuesEventPayload({
          ...validIssue,
          issue: { ...validIssue.issue, state: 5 },
        }),
      ).toThrow(WebhookPayloadValidationError);
    });
  });
});
