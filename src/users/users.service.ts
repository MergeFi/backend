import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GithubAccount, User } from '../common/entities';
import { UserRole } from '../common/enums';
import { PublicUserDto } from './dto/public-user.dto';
import { toPublicUser } from './users.mapper';

export interface UpsertFromGithubInput {
  githubId: string;
  login: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  accessToken: string;
  refreshToken?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(GithubAccount)
    private readonly githubAccountRepo: Repository<GithubAccount>,
  ) {}

  async findOneRaw(id: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: { githubAccount: true },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async findById(id: string): Promise<PublicUserDto> {
    const user = await this.findOneRaw(id);
    return toPublicUser(user);
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { username } });
  }

  /** Finds or creates a User + GithubAccount from a completed OAuth handshake. */
  async upsertFromGithub(input: UpsertFromGithubInput): Promise<User> {
    let account = await this.githubAccountRepo.findOne({
      where: { githubId: input.githubId },
      relations: { user: true },
    });

    if (account) {
      account.accessToken = input.accessToken;
      account.refreshToken = input.refreshToken ?? null;
      account.avatarUrl = input.avatarUrl;
      account.profileUrl = input.profileUrl;
      account.login = input.login;
      await this.githubAccountRepo.save(account);

      // Keep the parent User row in sync with the fresh GitHub profile so
      // bounty listings / dashboards do not display stale username/avatar data.
      const user = await this.findOneRaw(account.userId);
      let needsSave = false;

      if (user.username !== input.login) {
        const existingByUsername = await this.userRepo.findOne({
          where: { username: input.login },
        });
        if (!existingByUsername || existingByUsername.id === user.id) {
          user.username = input.login;
          needsSave = true;
        }
      }
      if (user.displayName !== input.displayName) {
        user.displayName = input.displayName;
        needsSave = true;
      }
      if (user.avatarUrl !== input.avatarUrl) {
        user.avatarUrl = input.avatarUrl;
        needsSave = true;
      }
      if (user.email !== input.email) {
        if (input.email === null) {
          user.email = null;
          needsSave = true;
        } else {
          const existingByEmail = await this.userRepo.findOne({
            where: { email: input.email },
          });
          if (!existingByEmail || existingByEmail.id === user.id) {
            user.email = input.email;
            needsSave = true;
          }
        }
      }
      if (needsSave) {
        await this.userRepo.save(user);
      }
      return this.findOneRaw(account.userId);
    }

    // No GithubAccount for this githubId — this is a new GitHub identity.
    // Never fall back to a username lookup (GitHub usernames are recyclable;
    // reusing a User row by username would allow account takeover). Always
    // create a fresh User, handling username collisions by generating a
    // unique variant.
    let username = input.login;
    const existingUsername = await this.userRepo.findOne({
      where: { username },
    });
    if (existingUsername) {
      username = await this.generateUniqueUsername(input.login);
    }

    let email: string | null = input.email;
    if (email !== null) {
      const existingEmail = await this.userRepo.findOne({
        where: { email },
      });
      if (existingEmail) {
        email = null;
      }
    }

    let user = this.userRepo.create({
      username,
      email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      roles: [UserRole.CONTRIBUTOR],
    });
    user = await this.userRepo.save(user);

    account = this.githubAccountRepo.create({
      githubId: input.githubId,
      login: input.login,
      avatarUrl: input.avatarUrl,
      profileUrl: input.profileUrl,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken ?? null,
      userId: user.id,
    });
    await this.githubAccountRepo.save(account);

    return this.findOneRaw(user.id);
  }

  private async generateUniqueUsername(base: string): Promise<string> {
    let candidate = base;
    let counter = 0;
    while (await this.userRepo.findOne({ where: { username: candidate } })) {
      counter += 1;
      candidate = `${base}-${counter}`;
      if (counter > 100) {
        candidate = `${base}-${Date.now()}-${counter}`;
        break;
      }
    }
    return candidate;
  }

  // Role assignment is intentionally out of scope for this version: a User's
  // `roles` are seeded to [UserRole.CONTRIBUTOR] at creation (upsertFromGithub)
  // and are not mutated by any API endpoint or admin flow today. The
  // MAINTAINER / SPONSOR roles remain declared but unreachable until a
  // guarded role-assignment endpoint (or sponsor-verification flow) is added.
  // Keeping role mutation out of the public service surface prevents a reader
  // from mistaking an unused method for a working feature.

  async setStellarAddress(
    userId: string,
    stellarAddress: string,
  ): Promise<User> {
    const user = await this.findOneRaw(userId);
    user.stellarAddress = stellarAddress;
    return this.userRepo.save(user);
  }

  async list(): Promise<PublicUserDto[]> {
    const users = await this.userRepo.find();
    return users.map(toPublicUser);
  }
}
