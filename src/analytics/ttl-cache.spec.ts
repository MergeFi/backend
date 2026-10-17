import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('should return cached value within TTL without calling loader again', async () => {
    const cache = new TtlCache<number>(1000);
    const loader = jest.fn().mockResolvedValue(42);

    const first = await cache.getOrLoad(loader);
    const second = await cache.getOrLoad(loader);

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('should coalesce concurrent calls into a single loader invocation', async () => {
    const cache = new TtlCache<string>(1000);
    let resolveLoader!: (val: string) => void;
    const loader = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const p1 = cache.getOrLoad(loader);
    const p2 = cache.getOrLoad(loader);

    resolveLoader('result');
    const [res1, res2] = await Promise.all([p1, p2]);

    expect(res1).toBe('result');
    expect(res2).toBe('result');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('should discard in-flight result if invalidate() was called while loading (#463)', async () => {
    const cache = new TtlCache<string>(5000);
    let resolveStale!: (val: string) => void;

    const staleLoader = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveStale = resolve;
        }),
    );

    // 1. Uruchamiamy powolny loader
    const stalePromise = cache.getOrLoad(staleLoader);

    // 2. W trakcie trwania zapytania następuje unieważnienie cache
    cache.invalidate();

    // 3. Stary loader kończy działanie
    resolveStale('stale_data');
    await stalePromise;

    // 4. Kolejne odpytanie musi wymusić świeże pobranie zamiast serwować stale_data
    const freshLoader = jest.fn().mockResolvedValue('fresh_data');
    const freshResult = await cache.getOrLoad(freshLoader);

    expect(freshResult).toBe('fresh_data');
    expect(freshLoader).toHaveBeenCalledTimes(1);
  });
});
