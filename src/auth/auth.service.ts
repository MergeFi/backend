import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '../common/entities';
import { UsersService, UpsertFromGithubInput } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async loginWithGithub(
    profile: UpsertFromGithubInput,
  ): Promise<{ user: User; accessToken: string }> {
    const user = await this.usersService.upsertFromGithub(profile);
    const accessToken = this.signToken(user);
    return { user, accessToken };
  }

  signToken(user: User): string {
    return this.jwtService.sign({ sub: user.id, username: user.username });
  }
}
