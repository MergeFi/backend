import { buildCorsOriginHandler } from './cors-origins';

function allow(
  handler: ReturnType<typeof buildCorsOriginHandler>,
  origin: string | undefined,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    handler(origin, (err, ok) => {
      if (err) reject(err);
      else resolve(ok ?? false);
    });
  });
}

describe('buildCorsOriginHandler', () => {
  const handler = buildCorsOriginHandler([
    'https://app.mergefi.dev',
    'https://staging.mergefi.dev',
    '*.vercel.app',
  ]);

  it('allows an exact-match origin', async () => {
    await expect(allow(handler, 'https://app.mergefi.dev')).resolves.toBe(true);
    await expect(allow(handler, 'https://staging.mergefi.dev')).resolves.toBe(true);
  });

  it('rejects an origin not in the allowlist', async () => {
    await expect(allow(handler, 'https://evil.example.com')).rejects.toThrow(
      "Origin 'https://evil.example.com' is not allowed by CORS policy",
    );
  });

  it('allows a Vercel preview URL matching the *.vercel.app pattern', async () => {
    await expect(
      allow(handler, 'https://mergefi-git-feat-123-acme.vercel.app'),
    ).resolves.toBe(true);
  });

  it('rejects a URL that only ends with the suffix but is not under the right TLD', async () => {
    await expect(
      allow(handler, 'https://evil.not-vercel.app'),
    ).rejects.toThrow(/is not allowed/);
  });

  it('allows requests with no Origin header (server-to-server)', async () => {
    await expect(allow(handler, undefined)).resolves.toBe(true);
  });

  it('does not allow an origin that is a superset of an allowed exact origin', async () => {
    await expect(
      allow(handler, 'https://app.mergefi.dev.evil.com'),
    ).rejects.toThrow(/is not allowed/);
  });

  it('falls through correctly when only exact origins are configured', async () => {
    const exactOnly = buildCorsOriginHandler(['https://app.mergefi.dev']);
    await expect(allow(exactOnly, 'https://app.mergefi.dev')).resolves.toBe(true);
    await expect(allow(exactOnly, 'https://other.vercel.app')).rejects.toThrow(/is not allowed/);
  });
});
