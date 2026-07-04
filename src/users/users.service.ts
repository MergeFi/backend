import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GithubAccount, User } from '../common/entities';
import { UserRole } from '../common/enums';

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

  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: { githubAccount: true },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
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
      return this.findById(account.userId);
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

    return this.findById(user.id);
  }

  async addRole(userId: string, role: UserRole): Promise<User> {
    const user = await this.findById(userId);
    if (!user.roles.includes(role)) {
      user.roles = [...user.roles, role];
      await this.userRepo.save(user);
    }
    return user;
  }

  async setStellarAddress(
    userId: string,
    stellarAddress: string,
  ): Promise<User> {
    const user = await this.findById(userId);
    user.stellarAddress = stellarAddress;
    return this.userRepo.save(user);
  }

  async list(): Promise<User[]> {
    return this.userRepo.find();
  }
}
