import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { AppConfig } from '../../config/configuration';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  username: string;
}

export function cookieExtractor(req: Request): string | null {
  if (!req) return null;
  // If cookie-parser is installed, req.cookies will be populated.
  const cookies = (req as unknown as { cookies?: Record<string, string> })
    .cookies;
  if (cookies && cookies['access_token']) return cookies['access_token'];
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === 'access_token') {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// How long a confirmed user is trusted without another lookup (#773). A deleted
// user therefore keeps access for at most this long.
const USER_CONFIRM_TTL_MS = 60_000;
const USER_CONFIRM_MAX_ENTRIES = 10_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // userId -> the time until which the user is known to exist.
  private readonly confirmedUntil = new Map<string, number>();

  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt', { infer: true }).secret,
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload?.sub) throw new UnauthorizedException('Invalid token payload');
    if (!this.isConfirmed(payload.sub)) {
      try {
        await this.usersService.findOneRaw(payload.sub);
      } catch {
        throw new UnauthorizedException('User no longer exists');
      }
      this.rememberConfirmed(payload.sub);
    }
    return { userId: payload.sub, username: payload.username };
  }

  private isConfirmed(userId: string): boolean {
    const until = this.confirmedUntil.get(userId);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.confirmedUntil.delete(userId);
    return false;
  }

  private rememberConfirmed(userId: string): void {
    if (this.confirmedUntil.size >= USER_CONFIRM_MAX_ENTRIES) {
      // Maps keep insertion order, so the first key is the oldest entry.
      const oldest = this.confirmedUntil.keys().next().value;
      if (oldest !== undefined) this.confirmedUntil.delete(oldest);
    }
    this.confirmedUntil.set(userId, Date.now() + USER_CONFIRM_TTL_MS);
  }
}
