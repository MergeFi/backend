import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler'; // Added Throttle decorator import
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AppConfig } from '../config/configuration';
import type { UpsertFromGithubInput } from '../users/users.service';
import { ApiInternalErrorResponse } from '../common/swagger/api-common-responses.decorator';

@ApiTags('auth')
@Controller('auth')
@ApiInternalErrorResponse()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  // OAuth Initiation protection against brute force session state initialization
  @Throttle({ short: { limit: 3, ttl: 1000 } })
  @Get('github')
  @UseGuards(GithubAuthGuard)
  @ApiExcludeEndpoint()
  githubLogin() {
    // Redirect handled by passport-github2; this handler body never runs.
  }

  // OAuth Completion protection against brute force state parameter hijacking (max 20 req/min)
  @Throttle({ medium: { limit: 20, ttl: 60000 } })
  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  @ApiExcludeEndpoint()
  async githubCallback(@Req() req: Request, @Res() res: Response) {
    const frontendUrl = this.configService.get('frontendUrl', { infer: true });
    try {
      const profile = req.user as UpsertFromGithubInput;
      const { accessToken } = await this.authService.loginWithGithub(profile);
      const code = this.authService.createHandoffCode(accessToken);
      // Defense-in-depth: also set the JWT as an httpOnly cookie so a frontend
      // that prefers cookie-based auth never needs to handle a bearer token in
      // the URL at all. The handoff code remains the primary exchange mechanism.
      const isProd =
        this.configService.get('env', { infer: true }) === 'production';
      // The frontend is a different origin, so its fetches only send this
      // cookie when it is SameSite=None, which browsers accept only with
      // Secure. Outside production (plain http) lax is used, since localhost
      // origins count as same-site there (#772).
      res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });
      res.redirect(`${frontendUrl}/auth/callback?code=${code}`);
    } catch (err) {
      // A failure between the GitHub profile and the JWT (DB upsert, signing)
      // would otherwise leave the user on a raw 500 page mid-OAuth (#298).
      this.logger.error(
        `GitHub OAuth callback failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      res.redirect(`${frontendUrl}/auth/callback?error=oauth_failed`);
    }
  }

  // Single-use codes are only as strong as the attempts allowed against them
  // (#770). The exchange is capped per IP well below the global limit.
  // One handler serves both paths, so the throttle and audit rules apply to the
  // operation once rather than per alias (#807). `/auth/exchange` remains for
  // clients that cannot be updated; remove it once nothing calls it.
  @Throttle({ medium: { limit: 10, ttl: 60_000 } })
  @Post(['handoff', 'exchange'])
  @HttpCode(200)
  @ApiExcludeEndpoint()
  exchangeHandoff(
    @Body('code') code: string,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.exchangeCode(code, ip, req.path);
  }

  /**
   * Shared single-use handoff-code exchange for /handoff and /exchange.
   * Failed attempts are logged at warn (#366) so bursts of guessed or
   * replayed codes are visible server-side. The code itself is never logged.
   */
  private exchangeCode(code: unknown, ip: string, route: string) {
    if (!code || typeof code !== 'string') {
      this.logger.warn(
        `Handoff exchange rejected on ${route} from ${ip}: missing code`,
      );
      throw new UnauthorizedException('Missing handoff code');
    }
    const token = this.authService.consumeHandoffCode(code);
    if (!token) {
      this.logger.warn(
        `Handoff exchange rejected on ${route} from ${ip}: invalid or expired code`,
      );
      throw new UnauthorizedException('Invalid or expired handoff code');
    }
    return { accessToken: token };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request) {
    return req.user;
  }

  /**
   * Revokes every token issued to the caller and clears the auth cookie (#774).
   * Tokens already in other clients stop working on their next request.
   */
  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.revokeTokens((req.user as { userId: string }).userId);
    res.clearCookie('access_token');
    return { loggedOut: true };
  }
}
