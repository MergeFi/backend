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
      await this.githubAccountRepo.save(account);
      return this.findOneRaw(account.userId);
    }

    let user = await this.userRepo.findOne({
      where: { username: input.login },
    });
    if (!user) {
      user = this.userRepo.create({
        username: input.login,
        email: input.email,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        roles: [UserRole.CONTRIBUTOR],
      });
      user = await this.userRepo.save(user);
    }

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
