import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies the `X-Hub-Signature-256` header GitHub sends on every webhook
 * delivery: `sha256=<hex hmac of raw body using the webhook secret>`.
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
export function verifyGithubSignature(
  secret: string,
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
