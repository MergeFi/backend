import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('loads and caches data for the duration of the TTL', async () => {
    const cache = new TtlCache<string>(5000);
    const loader = jest.fn().mockResolvedValue('value-1');

    const result1 = await cache.getOrLoad(loader);
    expect(result1).toBe('value-1');
    expect(loader).toHaveBeenCalledTimes(1);

    // Call within TTL should return cached value
    jest.advanceTimersByTime(2000);
    const result2 = await cache.getOrLoad(loader);
    expect(result2).toBe('value-1');
    expect(loader).toHaveBeenCalledTimes(1);

    // After TTL expires, loader should be called again
    jest.advanceTimersByTime(4000);
    loader.mockResolvedValueOnce('value-2');
    const result3 = await cache.getOrLoad(loader);
    expect(result3).toBe('value-2');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent misses so loader is only called once', async () => {
    const cache = new TtlCache<string>(5000);
    let resolveLoader!: (val: string) => void;
    const loader = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const promise1 = cache.getOrLoad(loader);
    const promise2 = cache.getOrLoad(loader);

    resolveLoader('concurrent-result');

    const [res1, res2] = await Promise.all([promise1, promise2]);
    expect(res1).toBe('concurrent-result');
    expect(res2).toBe('concurrent-result');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('handles invalidate while load is in flight', async () => {
    const cache = new TtlCache<string>(5000);
    let resolveLoader!: (val: string) => void;
    const loader = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const promise1 = cache.getOrLoad(loader);
    cache.invalidate();

    resolveLoader('loaded-data');
    const res = await promise1;
    expect(res).toBe('loaded-data');

    // Invalidate should have cleared entry, or subsequent call fetches if expired/invalidated
    cache.invalidate();
    loader.mockResolvedValueOnce('fresh-data');
    const res2 = await cache.getOrLoad(loader);
    expect(res2).toBe('fresh-data');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
