Below is a **drop‑in, production‑ready patch** that turns the single flat
IP‑based bucket into a *multi‑tier* rate‑limit strategy:

| Tier | What it protects | How it works |
|------|------------------|--------------|
| **Global** | All requests (fallback) | 120 req/min per IP (unchanged) |
| **Per‑route** | Sensitive endpoints (login, webhooks, financial mutations) | `@Throttle()` decorator with custom limits |
| **Per‑account** | Authenticated users on mutation routes | Custom `ThrottlerGuard` that uses the authenticated user’s ID as the key (IP + user) |
| **IP whitelist** | GitHub webhooks | Additional guard that only allows requests from GitHub’s IP ranges |

The patch adds a **custom guard** (`CustomThrottlerGuard`) that overrides the
default key‑generation logic, a **whitelist guard** for GitHub webhooks,
and shows how to apply the decorators in the relevant controllers.

> **⚠️  IMPORTANT** – The code below assumes you already have the
> `@nestjs/throttler` package installed and that your authentication
> middleware attaches the user object to `request.user` (typical with
> Passport/JWT). Adjust the key extraction logic if your auth stack is
> different.

---

## 1.  `src/common/guards/custom-throttler.guard.ts`

```ts
import {
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { Request } from 'express';

/**
 * Custom ThrottlerGuard that:
 *   • Uses the authenticated user id as the key when available.
 *   • Falls back to the IP address for unauthenticated requests.
 *
 * This gives per‑account limits on mutation routes while still protecting
 * unauthenticated endpoints.
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(CustomThrottlerGuard.name);

  /**
   * Override the key that identifies the bucket.
   * The key is a string that will be stored in the throttler store.
   */
  protected async getTrackerKey(
    context: ExecutionContext,
  ): Promise<string> {
    const request = context.switchToHttp().getRequest<Request>();

    // 1️⃣  Authenticated user → use user id
    if (request.user && request.user.id) {
      return `user:${request.user.id}`;
    }

    // 2️⃣  Unauthenticated → use IP
    const ip = request.ip ?? request.connection.remoteAddress ?? 'unknown';
    return `ip:${ip}`;
  }

  /**
   * Optional: Throw a 401 instead of 429 when the user is not authenticated
   * and the route is protected by `@UseGuards(AuthGuard)`.  This is purely
   * cosmetic – the throttler still counts the request.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return (await super.canActivate(context)) as boolean;
    } catch (err) {
      if (err instanceof ThrottlerException) {
        // If the request is unauthenticated but the route requires auth,
        // we can surface a 401 instead of 429.
        const request = context.switchToHttp().getRequest<Request>();
        if (!request.user) {
          throw new UnauthorizedException(
            'Authentication required before rate limiting applies',
          );
        }
        throw err;
      }
      throw err;
    }
  }
}
