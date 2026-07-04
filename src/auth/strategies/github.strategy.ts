import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { AppConfig } from '../../config/configuration';

export interface GithubProfile {
  id: string;
  username: string;
  displayName: string;
  profileUrl: string;
  photos?: { value: string }[];
  emails?: { value: string }[];
}

@Injectable()
export class GithubStrategy extends PassportStrategy(GitHubStrategy, 'github') {
  constructor(configService: ConfigService<AppConfig, true>) {
    const github = configService.get('github', { infer: true });
    super({
      clientID: github.clientId,
      clientSecret: github.clientSecret,
      callbackURL: github.oauthCallbackUrl,
      scope: ['user:email', 'read:org'],
    });
  }

  validate(
    accessToken: string,
    refreshToken: string,
    profile: GithubProfile,
    done: (err: unknown, user?: unknown) => void,
  ) {
    const user = {
      githubId: profile.id,
      login: profile.username,
      displayName: profile.displayName ?? profile.username,
      avatarUrl: profile.photos?.[0]?.value ?? null,
      profileUrl: profile.profileUrl,
      email: profile.emails?.[0]?.value ?? null,
      accessToken,
      refreshToken,
    };
    done(null, user);
  }
}
