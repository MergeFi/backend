/**
 * Builds the CORS `origin` callback for `app.enableCors`.
 *
 * Each entry in `allowedOrigins` is either:
 *   - an exact origin string   e.g. "https://app.mergefi.dev"
 *   - a `*.suffix` pattern     e.g. "*.vercel.app" (matches any
 *     single-label subdomain of vercel.app — useful for Vercel preview URLs)
 *
 * Server-to-server requests that carry no Origin header are always allowed.
 *
 * Returns a standard Express/NestJS CORS origin callback
 * `(origin, callback) => void`.
 */
export function buildCorsOriginHandler(
  allowedOrigins: string[],
): (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void {
  const exact = new Set(allowedOrigins.filter((o) => !o.startsWith('*.')));
  const suffixes = allowedOrigins
    .filter((o) => o.startsWith('*.'))
    .map((o) => o.slice(1)); // "*.vercel.app" → ".vercel.app"

  return (origin, callback) => {
    // No Origin header: same-origin or server-to-server — allow.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (exact.has(origin)) {
      callback(null, true);
      return;
    }

    if (suffixes.some((suffix) => origin.endsWith(suffix))) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin '${origin}' is not allowed by CORS policy`));
  };
}
