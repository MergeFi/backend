import { randomBytes, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

export const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_COOKIE_PATH = '/auth/github';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index !== -1 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

/**
 * OAuth `state` store for passport-oauth2, which has no session here.
 *
 * The state is a random nonce, and the same nonce is set as an httpOnly cookie
 * on the browser that starts the login. The callback is accepted only when the
 * state from GitHub matches that cookie. Without the binding, an attacker could
 * start a login, send the victim to the callback with the attacker's state, and
 * log the victim into the attacker's GitHub account (login CSRF).
 */
export class GithubOAuthStateStore {
  constructor(private readonly secure: boolean) {}

  store(
    req: Request,
    callback: (err: Error | null, state?: string) => void,
  ): void {
    const nonce = randomBytes(32).toString('hex');
    req.res?.cookie(OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: this.secure,
      // Lax, not strict: GitHub redirects back with a top-level GET, which
      // lax cookies are sent on.
      sameSite: 'lax',
      maxAge: OAUTH_STATE_TTL_MS,
      path: OAUTH_STATE_COOKIE_PATH,
    });
    callback(null, nonce);
  }

  verify(
    req: Request,
    providedState: string,
    callback: (err: Error | null, valid?: boolean, reason?: string) => void,
  ): void {
    const expected = readCookie(req, OAUTH_STATE_COOKIE);
    // One use: the cookie is cleared whether or not the state matches.
    req.res?.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_STATE_COOKIE_PATH });

    const a = Buffer.from(expected ?? '');
    const b = Buffer.from(providedState ?? '');
    const matches =
      expected !== null && a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
    if (!matches) {
      callback(null, false, 'Invalid OAuth state');
      return;
    }
    callback(null, true);
  }
}
