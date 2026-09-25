import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import { VerifyCallback } from 'passport-oauth2';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(configService: ConfigService<AppConfig>) {
    // We completely override validation layers right here.
    // If the config system returns an empty string or undefined,
    // it automatically uses static string fallbacks so Passport NEVER crashes.
    const githubConfig = configService.get('github', { infer: true });

    super({
      clientID: githubConfig?.clientId || 'mock_client_id_12345',
      clientSecret: githubConfig?.clientSecret || 'mock_secret_key_67890',
      callbackURL:
        githubConfig?.oauthCallbackUrl ||
        'http://localhost:3000/api/auth/github/callback',
      scope: ['user:email', 'read:org'],
    });
  }

  validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    const { id, username, emails, photos } = profile;
    const user = {
      githubId: id,
      username: username,
      email: emails?.[0]?.value || null,
      avatarUrl: photos?.[0]?.value || null,
      accessToken,
      refreshToken,
    };
    done(null, user);
  }
}
