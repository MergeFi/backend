import {
  Body,
  Controller,
  Get,
  HttpCode,
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

@ApiTags('auth')
@Controller('auth')
export class AuthController {
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
    const profile = req.user as UpsertFromGithubInput;
    const { accessToken } = await this.authService.loginWithGithub(profile);
    const code = this.authService.createHandoffCode(accessToken);
    // Defense-in-depth: also set the JWT as an httpOnly cookie so a frontend
    // that prefers cookie-based auth never needs to handle a bearer token in
    // the URL at all. The handoff code remains the primary exchange mechanism.
    const isProd =
      this.configService.get('env', { infer: true }) === 'production';
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    const frontendUrl = this.configService.get('frontendUrl', { infer: true });
    res.redirect(`${frontendUrl}/auth/callback?code=${code}`);
  }

  @Post('handoff')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async exchangeHandoff(@Body('code') code: string) {
    if (!code || typeof code !== 'string') {
      throw new UnauthorizedException('Missing handoff code');
    }
    const token = this.authService.consumeHandoffCode(code);
    if (!token) {
      throw new UnauthorizedException('Invalid or expired handoff code');
    }
    return { accessToken: token };
  }

  @Post('exchange')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async exchangeHandoffAlias(@Body('code') code: string) {
    // Alias for POST /auth/exchange — same single-use semantics as /handoff.
    if (!code || typeof code !== 'string') {
      throw new UnauthorizedException('Missing handoff code');
    }
    const token = this.authService.consumeHandoffCode(code);
    if (!token) {
      throw new UnauthorizedException('Invalid or expired handoff code');
    }
    return { accessToken: token };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request) {
    return req.user;
  }
}
