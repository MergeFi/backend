import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { Repository as RepositoryEntity } from '../../common/entities';
import { User } from '../../common/entities';
import { UserRole } from '../../common/enums';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { REPO_SCOPED_SYNC_KEY } from '../decorators/repo-scoped-sync.decorator';
import { AppConfig } from '../../config/configuration';

interface AuthenticatedRequest extends Request {
  user?: { userId: string };
  params?: { owner?: string; repo?: string };
}

/**
 * Per-repository authorization for maintainer-only sync routes (#312).
 *
 * `RolesGuard` answers "is this user a maintainer?" and nothing about *which*
 * repositories they may act on, so a single MAINTAINER could sync any public
 * GitHub repository and spend the shared Octokit token's rate-limit budget on
 * repos this platform has no relationship with.
 *
 * `Repository.maintainerId` exists for exactly this scoping but was never read.
 * This guard enforces it:
 *
 *  - the repository is already tracked **and** names a maintainer → only that
 *    maintainer may sync it;
 *  - the repository is tracked but has no maintainer recorded → any maintainer
 *    may sync it (unchanged behaviour, and it lets the first claimant take it);
 *  - the repository is not tracked at all → a first-time sync is allowed only
 *    for a maintainer listed in the configured allowlist
 *    (`GITHUB_SYNC_ALLOWED_REPOS`, exact `owner/repo` entries), so an
 *    untracked repo cannot be introduced at will.
 */
@Injectable()
export class RepoScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RepositoryEntity)
    private readonly repositoryRepo: Repository<RepositoryEntity>,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(
      REPO_SCOPED_SYNC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.userId) {
      throw new ForbiddenException('Authentication is required');
    }

    const owner = request.params?.owner;
    const repo = request.params?.repo;
    if (!owner || !repo) {
      throw new NotFoundException('Repository owner and name are required');
    }
    const fullName = `${owner}/${repo}`;

    const user = await this.userRepo.findOne({
      where: { id: request.user.userId },
      select: { id: true, roles: true },
    });
    if (!user) throw new ForbiddenException('Authenticated user no longer exists');
    if (!user.roles.includes(UserRole.MAINTAINER)) {
      throw new ForbiddenException('Maintainer role required');
    }

    const tracked = await this.repositoryRepo.findOne({
      where: { fullName },
      select: { id: true, maintainerId: true },
    });

    // Untracked repository: only the allowlist may introduce a new one.
    if (!tracked) {
      if (this.isAllowlisted(fullName)) return true;
      throw new ForbiddenException(
        `First-time sync of ${fullName} is not permitted. ` +
          `Add it to GITHUB_SYNC_ALLOWED_REPOS or assign its maintainer first.`,
      );
    }

    // Tracked with an owner: that maintainer only.
    if (tracked.maintainerId) {
      if (tracked.maintainerId === user.id) return true;
      throw new ForbiddenException(
        `${fullName} is assigned to another maintainer`,
      );
    }

    // Tracked with no maintainer yet: allow, and claim it for this user so the
    // scope is explicit from here on.
    await this.repositoryRepo.update({ id: tracked.id }, { maintainerId: user.id });
    return true;
  }

  /** Exact `owner/repo` entries from `GITHUB_SYNC_ALLOWED_REPOS`. */
  private isAllowlisted(fullName: string): boolean {
    const raw = this.configService.get('github', { infer: true })
      .syncAllowedRepos;
    if (!raw) return false;
    return raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
      .includes(fullName.toLowerCase());
  }
}
