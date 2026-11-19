import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService();
  });

  describe('getHealth', () => {
    it('returns the exact public payload shape', () => {
      const health = service.getHealth();

      // The root route is excluded from the global prefix (main.ts) so
      // container health checks and load-balancer probes can hit it; they
      // depend on this shape, so any new key must be a deliberate change.
      expect(Object.keys(health).sort()).toEqual([
        'service',
        'status',
        'timestamp',
      ]);
      expect(health.status).toBe('ok');
      expect(health.service).toBe('mergefi-backend');
    });

    it('returns the current time as an ISO-8601 timestamp', () => {
      const before = Date.now();
      const { timestamp } = service.getHealth();
      const after = Date.now();

      expect(new Date(timestamp).toISOString()).toBe(timestamp);
      expect(Date.parse(timestamp)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(timestamp)).toBeLessThanOrEqual(after);
    });

    it('does not leak version or environment detail', () => {
      const serialized = JSON.stringify(service.getHealth()).toLowerCase();

      for (const key of [
        'version',
        'env',
        'node',
        'database',
        'uptime',
        'commit',
      ]) {
        expect(serialized).not.toContain(`"${key}`);
      }
      expect(serialized).not.toContain(process.version.toLowerCase());
      if (process.env.NODE_ENV) {
        expect(serialized).not.toContain(
          `"${process.env.NODE_ENV.toLowerCase()}"`,
        );
      }
    });

    it('is a liveness check only — it has no dependencies and does not reflect database connectivity', () => {
      // Pinned so that turning this into a readiness probe (e.g. injecting a
      // DataSource and pinging Postgres) is a visible, reviewed change rather
      // than something orchestrators discover when probes start failing.
      expect(AppService.length).toBe(0);
      expect(
        Reflect.getMetadata('design:paramtypes', AppService) ?? [],
      ).toEqual([]);
    });
  });
});
