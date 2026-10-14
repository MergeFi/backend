import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('returns the loaded value on a miss', async () => {
    const cache = new TtlCache<number>(60_000);
    const loader = jest.fn().mockResolvedValue(42);
    expect(await cache.getOrLoad(loader)).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('serves the cached value within the TTL without reloading', async () => {
    const cache = new TtlCache<number>(60_000);
    const loader = jest.fn().mockResolvedValue(7);
    await cache.getOrLoad(loader);
    await cache.getOrLoad(loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent misses into one loader call (single-flight)', async () => {
    const cache = new TtlCache<number>(60_000);
    let resolve: (v: number) => void = () => {};
    const loader = jest.fn(() => new Promise<number>((r) => (resolve = r)));
    const p1 = cache.getOrLoad(loader);
    const p2 = cache.getOrLoad(loader);
    resolve(5);
    expect(await Promise.all([p1, p2])).toEqual([5, 5]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL expires', async () => {
    const cache = new TtlCache<number>(1); // 1ms TTL
    const loader = jest
      .fn()
      .mockResolvedValue(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValue(2);
    await cache.getOrLoad(loader);
    await new Promise((r) => setTimeout(r, 5));
    expect(await cache.getOrLoad(loader)).toBe(2);
  });

  it('invalidate() forces a reload', async () => {
    const cache = new TtlCache<number>(60_000);
    const loader = jest.fn().mockResolvedValueOnce(1).mockResolvedValue(2);
    await cache.getOrLoad(loader);
    cache.invalidate();
    expect(await cache.getOrLoad(loader)).toBe(2);
  });
});
