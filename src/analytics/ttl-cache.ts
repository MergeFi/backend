/**
 * Process-local TTL cache with single-flight load coalescing so concurrent
 * misses share one loader call (thundering-herd protection).
 */
export class TtlCache<T> {
  private entry: { data: T; expiresAt: number } | null = null;
  private inflight: Promise<T> | null = null;

  constructor(private readonly ttlMs: number) {}

  invalidate(): void {
    this.entry = null;
  }

  async getOrLoad(loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (this.entry && now < this.entry.expiresAt) {
      return this.entry.data;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = (async () => {
      try {
        const data = await loader();
        this.entry = { data, expiresAt: Date.now() + this.ttlMs };
        return data;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}
