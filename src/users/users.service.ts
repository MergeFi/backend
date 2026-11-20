import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import {
  GithubAccount,
  StellarAddressChallenge,
  User,
} from '../common/entities';
import { UserRole } from '../common/enums';
import { PublicUserDto } from './dto/public-user.dto';
import { toPublicUser } from './users.mapper';
import {
  buildStellarOwnershipMessage,
  STELLAR_OWNERSHIP_CHALLENGE_TTL_MS,
  verifyStellarOwnershipSignature,
} from './stellar-ownership';

export interface StellarAddressChallengeResult {
  message: string;
  nonce: string;
  expiresAt: Date;
}

export interface SetStellarAddressInput {
  stellarAddress: string;
  nonce: string;
  message: string;
  signature: string;
}

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

/** Attempts to insert a new user before giving up on username collisions (#790). */
const MAX_USERNAME_ATTEMPTS = 5;

/** True when a Postgres unique violation names the username column. */
function isUsernameViolation(err: unknown): boolean {
  const e = err as { code?: string; detail?: string };
  return e.code === '23505' && String(e.detail ?? '').includes('(username)');
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(GithubAccount)
    private readonly githubAccountRepo: Repository<GithubAccount>,
    @InjectRepository(StellarAddressChallenge)
    private readonly challengeRepo: Repository<StellarAddressChallenge>,
    private readonly config: ConfigService,
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
    const account = await this.githubAccountRepo.findOne({
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
    let email: string | null = input.email;
    if (email !== null) {
      const existingEmail = await this.userRepo.findOne({
        where: { email },
      });
      if (existingEmail) {
        email = null;
      }
    }

    // User and GithubAccount commit together. Separate saves could leave a User with no GithubAccount
    // if the second failed, and the next sign-in would then create a duplicate user (#789).
    const user = await this.saveNewIdentity(input, email);

    return this.findOneRaw(user.id);
  }

  /**
   * Inserts a new User and its GithubAccount in one transaction. The database decides username
   * uniqueness (#790): the preferred login is tried first. On a unique violation for `username`, the
   * whole transaction is rolled back and retried with a short random suffix. Rolling back is required,
   * because a Postgres transaction cannot continue after a failed statement.
   */
  private async saveNewIdentity(
    input: UpsertFromGithubInput,
    email: string | null,
  ): Promise<User> {
    let username = input.login;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.userRepo.manager.transaction(async (manager) => {
          const user = await manager.save(
            manager.create(User, {
              username,
              email,
              displayName: input.displayName,
              avatarUrl: input.avatarUrl,
              roles: [UserRole.CONTRIBUTOR],
            }),
          );
          await manager.save(
            manager.create(GithubAccount, {
              githubId: input.githubId,
              login: input.login,
              avatarUrl: input.avatarUrl,
              profileUrl: input.profileUrl,
              accessToken: input.accessToken,
              refreshToken: input.refreshToken ?? null,
              userId: user.id,
            }),
          );
          return user;
        });
      } catch (err) {
        if (!isUsernameViolation(err) || attempt >= MAX_USERNAME_ATTEMPTS) {
          throw err;
        }
        username = `${input.login}-${randomBytes(3).toString('hex')}`;
      }
    }
  }

  // Role assignment is intentionally out of scope for this version: a User's
  // `roles` are seeded to [UserRole.CONTRIBUTOR] at creation (upsertFromGithub)
  // and are not mutated by any API endpoint or admin flow today. The
  // MAINTAINER / SPONSOR roles remain declared but unreachable until a
  // guarded role-assignment endpoint (or sponsor-verification flow) is added.
  // Keeping role mutation out of the public service surface prevents a reader
  // from mistaking an unused method for a working feature.

  /**
   * Issues a single-use ownership challenge for `stellarAddress` (#791). The
   * returned `message` is what the wallet must sign; the PATCH echoes back
   * `nonce`, `message` and the signature.
   */
  async issueStellarAddressChallenge(
    userId: string,
    stellarAddress: string,
  ): Promise<StellarAddressChallengeResult> {
    await this.findOneRaw(userId);

    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + STELLAR_OWNERSHIP_CHALLENGE_TTL_MS,
    );
    const nonce = randomBytes(32).toString('base64url');
    const domain = new URL(this.config.getOrThrow<string>('frontendUrl')).host;
    const message = buildStellarOwnershipMessage({
      domain,
      userId,
      stellarAddress,
      nonce,
      issuedAt,
      expiresAt,
    });

    await this.challengeRepo.save(
      this.challengeRepo.create({
        userId,
        stellarAddress,
        nonce,
        message,
        expiresAt,
      }),
    );
    return { message, nonce, expiresAt };
  }

  /**
   * Links `stellarAddress` to the user only when the request carries a valid
   * signature over a live challenge issued to this user for this address
   * (#791). Every proof failure maps to the same 403 so the response does not
   * reveal which check failed.
   */
  async setStellarAddress(
    userId: string,
    input: SetStellarAddressInput,
  ): Promise<PublicUserDto> {
    const user = await this.findOneRaw(userId);
    const { stellarAddress, nonce, message, signature } = input;
    const rejected = () =>
      new ForbiddenException('Ownership proof is invalid or has expired');

    const challenge = await this.challengeRepo.findOne({
      where: { nonce, userId },
    });
    if (
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt.getTime() <= Date.now() ||
      challenge.stellarAddress !== stellarAddress ||
      challenge.message !== message
    ) {
      throw rejected();
    }

    if (!verifyStellarOwnershipSignature(stellarAddress, message, signature)) {
      throw rejected();
    }

    // Claim the nonce atomically. Two concurrent PATCHes that both passed the
    // checks above race here, and only one UPDATE matches consumedAt IS NULL.
    const claimed = await this.challengeRepo.update(
      { id: challenge.id, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    if (claimed.affected !== 1) {
      throw rejected();
    }

    user.stellarAddress = stellarAddress;
    // #359: return the same public shape as every other user-facing
    // method — the raw entity leaks email and the full nested
    // githubAccount object that toPublicUser exists specifically to strip.
    return toPublicUser(await this.userRepo.save(user));
  }

  async clearStellarAddress(userId: string): Promise<PublicUserDto> {
    const user = await this.findOneRaw(userId);
    user.stellarAddress = null;
    return toPublicUser(await this.userRepo.save(user));
  }

  async list(): Promise<PublicUserDto[]> {
    const users = await this.userRepo.find();
    return users.map(toPublicUser);
  }
}
