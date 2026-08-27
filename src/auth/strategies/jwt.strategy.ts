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

function cookieExtractor(req: Request): string | null {
  if (!req) return null;
  // If cookie-parser is installed, req.cookies will be populated.
  const cookies = (req as unknown as { cookies?: Record<string, string> })
    .cookies;
  if (cookies && cookies['access_token']) return cookies['access_token'];
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === 'access_token') return decodeURIComponent(rest.join('='));
  }
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
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
    try {
      await this.usersService.findOneRaw(payload.sub);
    } catch {
      throw new UnauthorizedException('User no longer exists');
    }
    return { userId: payload.sub, username: payload.username };
  }
}
