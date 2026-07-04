import { createHmac } from 'crypto';
import { verifyGithubSignature } from './webhook-signature.util';

describe('verifyGithubSignature', () => {
  const secret = 'test-webhook-secret';
  const payload = JSON.stringify({ action: 'closed', number: 42 });

  function sign(body: string, key: string): string {
    return `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;
  }

  it('accepts a correctly signed payload', () => {
    const signature = sign(payload, secret);
    expect(verifyGithubSignature(secret, payload, signature)).toBe(true);
  });

  it('rejects a payload signed with the wrong secret', () => {
    const signature = sign(payload, 'wrong-secret');
    expect(verifyGithubSignature(secret, payload, signature)).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const signature = sign(payload, secret);
    const tampered = JSON.stringify({ action: 'closed', number: 43 });
    expect(verifyGithubSignature(secret, tampered, signature)).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    expect(verifyGithubSignature(secret, payload, undefined)).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    const signature = sign(payload, secret);
    expect(verifyGithubSignature('', payload, signature)).toBe(false);
  });

  it('rejects a malformed/short signature header without throwing', () => {
    expect(verifyGithubSignature(secret, payload, 'sha256=abc')).toBe(false);
  });
});
