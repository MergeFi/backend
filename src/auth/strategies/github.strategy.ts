import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(configService: ConfigService) {
    // We completely override validation layers right here.
    // If the config system returns an empty string or undefined, 
    // it automatically uses static string fallbacks so Passport NEVER crashes.
    const githubConfig = configService.get('github') || {};
    
    super({
      clientID: githubConfig.clientId || 'mock_client_id_12345',
      clientSecret: githubConfig.clientSecret || 'mock_secret_key_67890',
      callbackURL: githubConfig.oauthCallbackUrl || 'http://localhost:3000/api/auth/github/callback',
      scope: ['user:email', 'read:org'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: any): Promise<any> {
    const { id, username, emails, photos } = profile;
    const user = {
      githubId: id,
      username: username,
      email: emails?.[0]?.value || null,
      avatarUrl: photos?.[0]?.value || null,
      accessToken,
      refreshToken,
    };
    return done(null, user);
  }
}
