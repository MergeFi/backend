import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { User } from '../common/entities';
import { UsersService, UpsertFromGithubInput } from '../users/users.service';

@Injectable()
export class AuthService {
  private readonly handoffCodes = new Map<
    string,
    { token: string; expiresAt: number }
  >();
  private readonly HANDOFF_TTL_MS = 5 * 60 * 1000;

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

  createHandoffCode(token: string): string {
    const code = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.HANDOFF_TTL_MS;
    this.handoffCodes.set(code, { token, expiresAt });
    // Opportunistically prune expired entries to bound memory.
    for (const [k, v] of this.handoffCodes.entries()) {
      if (Date.now() > v.expiresAt) this.handoffCodes.delete(k);
    }
    return code;
  }

  consumeHandoffCode(code: string): string | null {
    const entry = this.handoffCodes.get(code);
    if (!entry) return null;
    this.handoffCodes.delete(code);
    if (Date.now() > entry.expiresAt) return null;
    return entry.token;
  }
}
