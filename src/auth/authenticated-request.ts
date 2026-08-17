import type { Request } from 'express';

/**
 * Shape of `req.user` on a route behind {@link JwtAuthGuard}. This is exactly
 * what `JwtStrategy.validate` returns, and it is deliberately narrow: the JWT
 * carries an identity, not a profile. Anything else about the caller — their
 * linked `stellarAddress`, their roles — has to be read from the user record,
 * because a token claim is a snapshot the client holds and the database row is
 * the current truth.
 */
export interface AuthenticatedUser {
  userId: string;
  username: string;
}

/**
 * Express request on an authenticated route. `user` is non-optional here: the
 * guard rejects the request before the handler runs, so any handler typed with
 * this has already been proven to have a caller. Handlers that derive
 * money-moving identity from the caller should take this type rather than a
 * bare `Request`, so that dropping the guard becomes a type error rather than a
 * silent `undefined`.
 */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
