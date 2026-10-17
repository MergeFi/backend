import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the cached value within TTL without calling loader again', async () => {
    const cache = new TtlCache<number>(1_000);
    const loader = jest
      .fn()
      .mockResolvedValueOnce(42)
      .mockResolvedValueOnce(99);

    const first = await cache.getOrLoad(loader);
    const second = await cache.getOrLoad(loader);

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('refetches when TTL elapses with fake timers', async () => {
    const cache = new TtlCache<number>(1_000);
    const loader = jest
      .fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(20);

    const initial = await cache.getOrLoad(loader);
    expect(initial).toBe(10);
    expect(loader).toHaveBeenCalledTimes(1);

    // Advance time past TTL
    jest.advanceTimersByTime(1_001);

    const refreshed = await cache.getOrLoad(loader);
    expect(refreshed).toBe(20);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent misses onto one loader call', async () => {
    const cache = new TtlCache<string>(60_000);
    let resolveLoad!: (value: string) => void;
    const loader = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const load1 = cache.getOrLoad(loader);
    const load2 = cache.getOrLoad(loader);
    const load3 = cache.getOrLoad(loader);

    resolveLoad('shared_value');
    const [res1, res2, res3] = await Promise.all([load1, load2, load3]);

    expect(res1).toBe('shared_value');
    expect(res2).toBe('shared_value');
    expect(res3).toBe('shared_value');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('discards in-flight loader population if invalidate() is called while loading', async () => {
    const cache = new TtlCache<string>(60_000);
    let resolveStale!: (val: string) => void;

    const staleLoader = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveStale = resolve;
        }),
    );

    // 1. Trigger in-flight load
    const inFlightPromise = cache.getOrLoad(staleLoader);

    // 2. Invalidate while load is still in-flight
    cache.invalidate();

    // 3. Stale loader finally resolves
    resolveStale('stale_data');
    const staleResult = await inFlightPromise;
    expect(staleResult).toBe('stale_data');

    // 4. Subsequent getOrLoad must not return stale_data and must call a fresh loader
    const freshLoader = jest.fn().mockResolvedValue('fresh_data');
    const freshResult = await cache.getOrLoad(freshLoader);

    expect(freshResult).toBe('fresh_data');
    expect(freshLoader).toHaveBeenCalledTimes(1);
  });

  it('invalidates a cached entry when already resolved', async () => {
    const cache = new TtlCache<number>(60_000);
    const loader = jest
      .fn()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(200);

    const first = await cache.getOrLoad(loader);
    expect(first).toBe(100);

    cache.invalidate();

    const second = await cache.getOrLoad(loader);
    expect(second).toBe(200);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('cleans up in-flight promise and propagates error if loader rejects', async () => {
    const cache = new TtlCache<string>(60_000);
    const errorLoader = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network error'));
    const retryLoader = jest.fn().mockResolvedValueOnce('success');

    await expect(cache.getOrLoad(errorLoader)).rejects.toThrow('Network error');

    // Next attempt should retry rather than caching the rejection or hanging
    const result = await cache.getOrLoad(retryLoader);
    expect(result).toBe('success');
    expect(retryLoader).toHaveBeenCalledTimes(1);
  });
});
