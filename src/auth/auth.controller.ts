import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
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

  @Get('github')
  @UseGuards(GithubAuthGuard)
  @ApiExcludeEndpoint()
  githubLogin() {
    // Redirect handled by passport-github2; this handler body never runs.
  }

  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  @ApiExcludeEndpoint()
  async githubCallback(@Req() req: Request, @Res() res: Response) {
    const profile = req.user as UpsertFromGithubInput;
    const { accessToken } = await this.authService.loginWithGithub(profile);
    const frontendUrl = this.configService.get('frontendUrl', { infer: true });
    res.redirect(`${frontendUrl}/auth/callback?token=${accessToken}`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request) {
    return req.user;
  }
}
