import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { AppConfig } from '../config/configuration';

export const GITHUB_OCTOKIT = Symbol('GITHUB_OCTOKIT');

/**
 * Hard ceiling on retries for both plugins below, applied consistently so a
 * persistent outage or a misconfigured token can't retry forever — see #24.
 * GitHub's primary limit resets hourly and secondary limits are usually
 * seconds-to-low-minutes, so 3 attempts (4 total requests) is enough to ride
 * out a transient spike without a sync hanging indefinitely.
 */
export const GITHUB_MAX_RETRIES = 3;

const RetryingOctokit = Octokit.plugin(retry, throttling);

const octokitLogger = new Logger('GithubOctokit');

/**
 * Logs and caps retries for a primary (5000 req/hr) or secondary
 * (abuse-detection) rate-limit hit. Returning true tells the throttling
 * plugin to retry after `retryAfter` seconds; false lets the original
 * error propagate to the caller (syncIssues wraps that in a clearly
 * reported, resumable error — see GithubSyncInterruptedError).
 */
export function makeLimitHandler(kind: 'primary' | 'secondary') {
  return (
    retryAfter: number,
    options: { method: string; url: string },
    _octokit: unknown,
    retryCount: number,
  ): boolean => {
    const willRetry = retryCount < GITHUB_MAX_RETRIES;
    octokitLogger.warn(
      `GitHub ${kind} rate limit hit for ${options.method} ${options.url} — ` +
        `retrying after ${retryAfter}s (attempt ${retryCount + 1}/${GITHUB_MAX_RETRIES + 1})` +
        (willRetry ? '' : ' — giving up, ceiling reached'),
    );
    return willRetry;
  };
}

export function createGithubOctokit(
  configService: ConfigService<AppConfig, true>,
): Octokit {
  const token = configService.get('github', { infer: true }).apiToken;

  return new RetryingOctokit({
    ...(token ? { auth: token } : {}),
    retry: {
      retries: GITHUB_MAX_RETRIES,
      // plugin-retry's default doNotRetry already excludes 403 (secondary
      // rate limits); 429 (primary rate limit) is added here so it's retried
      // exactly once, by plugin-throttling's onRateLimit below, which knows
      // the actual Retry-After/x-ratelimit-reset values — plugin-retry's own
      // generic backoff would otherwise race it on the same error.
      doNotRetry: [400, 401, 403, 404, 410, 422, 429, 451],
    },
    throttle: {
      onRateLimit: makeLimitHandler('primary'),
      onSecondaryRateLimit: makeLimitHandler('secondary'),
    },
  });
}

export const githubOctokitProvider: Provider = {
  provide: GITHUB_OCTOKIT,
  useFactory: createGithubOctokit,
  inject: [ConfigService],
};
