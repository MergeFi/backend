import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Gates the OpenAPI document behind HTTP Basic auth (#809). `credentials` is
 * "user:password". The comparison is constant-time, and a missing, malformed or
 * wrong header gets a 401 with a WWW-Authenticate challenge.
 */
export function swaggerBasicAuth(credentials: string) {
  const expected = Buffer.from(credentials, 'utf8');

  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';
    const [scheme, encoded = ''] = header.split(' ');

    if (scheme === 'Basic' && encoded) {
      const provided = Buffer.from(encoded, 'base64');
      // timingSafeEqual throws on unequal lengths, so compare lengths first.
      if (
        provided.length === expected.length &&
        timingSafeEqual(provided, expected)
      ) {
        next();
        return;
      }
    }

    res.setHeader(
      'WWW-Authenticate',
      'Basic realm="MergeFi API docs", charset="UTF-8"',
    );
    res.status(401).end();
  };
}
