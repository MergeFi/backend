import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import {
  GITHUB_MAX_RETRIES,
  createGithubOctokit,
  makeLimitHandler,
} from './octokit.provider';

function mockConfigService(apiToken: string): ConfigService<AppConfig, true> {
  return {
    get: () => ({ apiToken }),
  } as unknown as ConfigService<AppConfig, true>;
}

describe('makeLimitHandler', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  const options = {
    method: 'GET',
    url: 'https://api.github.com/repos/a/b/issues',
  };

  it.each(['primary', 'secondary'] as const)(
    'retries while under the ceiling for a %s rate limit',
    (kind) => {
      const handler = makeLimitHandler(kind);
      const result = handler(5, options, {}, 0);
      expect(result).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(kind));
    },
  );

  it('stops retrying once GITHUB_MAX_RETRIES is reached, so a persistent outage cannot retry forever', () => {
    const handler = makeLimitHandler('primary');
    const result = handler(5, options, {}, GITHUB_MAX_RETRIES);
    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('giving up'));
  });

  it('logs the method/url/retryAfter so the interruption is traceable', () => {
    const handler = makeLimitHandler('secondary');
    handler(12, options, {}, 1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('GET https://api.github.com/repos/a/b/issues'),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('12s'));
  });
});

describe('createGithubOctokit', () => {
  it('constructs an authenticated Octokit instance when a token is configured', () => {
    const octokit = createGithubOctokit(mockConfigService('test-token'));
    expect(octokit).toBeDefined();
    expect(typeof octokit.request).toBe('function');
  });

  it('constructs an unauthenticated Octokit instance when no token is configured', () => {
    expect(() => createGithubOctokit(mockConfigService(''))).not.toThrow();
  });
});
