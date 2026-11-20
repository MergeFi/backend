import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Repository, User } from '../../common/entities';
import { UserRole } from '../../common/enums';
import { GithubController } from '../../github/github.controller';
import { RepoScopeGuard } from './repo-scope.guard';

/**
 * Per-repository authorization for maintainer-only sync routes (#312).
 *
 * MAINTAINER is a platform-wide role, so without this guard any maintainer
 * could sync any public GitHub repository and spend the shared Octokit token's
 * rate-limit budget on repositories this platform has nothing to do with.
 */
describe('RepoScopeGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const repositoryRepo = { findOne: jest.fn(), update: jest.fn() };
  const configService = {
    get: jest.fn().mockReturnValue({ syncAllowedRepos: '' }),
  };

  const context = (options: {
    user?: { userId: string };
    owner?: string;
    repo?: string;
  }) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: options.user,
          params: { owner: options.owner, repo: options.repo },
        }),
      }),
    }) as never;

  let guard: RepoScopeGuard;

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockReturnValue({ syncAllowedRepos: '' });
    reflector.getAllAndOverride.mockReturnValue(true);

    guard = await Test.createTestingModule({
      providers: [
        RepoScopeGuard,
        { provide: Reflector, useValue: reflector },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(Repository),
          useValue: repositoryRepo,
        },
        { provide: ConfigService, useValue: configService },
      ],
    })
      .compile()
      .then((module) => module.get(RepoScopeGuard));
  });

  const maintainerContext = (owner = 'acme', repo = 'repo') =>
    context({ user: { userId: 'user-1' }, owner, repo });

  it('is a no-op on routes that are not repo-scoped', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    await expect(guard.canActivate(maintainerContext())).resolves.toBe(true);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });

  it('allows the repository’s own maintainer', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      roles: [UserRole.MAINTAINER],
    });
    repositoryRepo.findOne.mockResolvedValue({
      id: 'repo-uuid-1',
      maintainerId: 'user-1',
    });

    await expect(guard.canActivate(maintainerContext())).resolves.toBe(true);
  });

  it('refuses a maintainer who does not own the repository', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-2',
      roles: [UserRole.MAINTAINER],
    });
    repositoryRepo.findOne.mockResolvedValue({
      id: 'repo-uuid-1',
      maintainerId: 'user-1',
    });

    await expect(guard.canActivate(maintainerContext())).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guard.canActivate(maintainerContext())).rejects.toThrow(
      /assigned to another maintainer/,
    );
  });

  it('claims an unassigned tracked repository for the first maintainer to sync it', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      roles: [UserRole.MAINTAINER],
    });
    repositoryRepo.findOne.mockResolvedValue({
      id: 'repo-uuid-1',
      maintainerId: null,
    });

    await expect(guard.canActivate(maintainerContext())).resolves.toBe(true);
    expect(repositoryRepo.update).toHaveBeenCalledWith(
      { id: 'repo-uuid-1' },
      { maintainerId: 'user-1' },
    );
  });

  it('refuses a first-time sync of an untracked repository', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      roles: [UserRole.MAINTAINER],
    });
    repositoryRepo.findOne.mockResolvedValue(null);

    await expect(guard.canActivate(maintainerContext())).rejects.toThrow(
      /First-time sync of acme\/repo is not permitted/,
    );
  });

  it('allows a first-time sync for an allowlisted repository', async () => {
    configService.get.mockReturnValue({ syncAllowedRepos: 'acme/repo' });
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      roles: [UserRole.MAINTAINER],
    });
    repositoryRepo.findOne.mockResolvedValue(null);

    await expect(guard.canActivate(maintainerContext())).resolves.toBe(true);
  });

  it('matches the allowlist case-insensitively and ignores stray whitespace', async () => {
    configService.get.mockReturnValue({
      syncAllowedRepos: ' other/repo , ACME/REPO ',
    });
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      roles: [UserRole.MAINTAINER],
    });
    repositoryRepo.findOne.mockResolvedValue(null);

    await expect(guard.canActivate(maintainerContext())).resolves.toBe(true);
  });

  it('refuses a user without the maintainer role', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      roles: [UserRole.CONTRIBUTOR],
    });

    await expect(guard.canActivate(maintainerContext())).rejects.toThrow(
      /Maintainer role required/,
    );
    expect(repositoryRepo.findOne).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated request', async () => {
    await expect(
      guard.canActivate(context({ owner: 'acme', repo: 'repo' })),
    ).rejects.toThrow(/Authentication is required/);
  });

  it('refuses a request whose authenticated user no longer exists', async () => {
    userRepo.findOne.mockResolvedValue(null);

    await expect(guard.canActivate(maintainerContext())).rejects.toThrow(
      /no longer exists/,
    );
  });

  it('refuses a request with no repository parameters', async () => {
    await expect(
      guard.canActivate(context({ user: { userId: 'user-1' } })),
    ).rejects.toThrow(NotFoundException);
  });
});

/**
 * The cases above mock the Reflector, so the real metadata path — the part
 * that can break silently, since the guard allows when metadata is absent —
 * is exercised only here, against the real decorated controller (#838).
 */
describe('RepoScopeGuard with the real Reflector (#838)', () => {
  const userRepo = { findOne: jest.fn() };
  const repositoryRepo = { findOne: jest.fn() };
  const configService = {
    get: jest.fn().mockReturnValue({ syncAllowedRepos: '' }),
  };
  let guard: RepoScopeGuard;

  const contextFor = <T>(
    controller: new (...args: never[]) => T,
    method: keyof T,
  ) =>
    ({
      getHandler: () => controller.prototype[method] as object,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: 'user-2' },
          params: { owner: 'acme', repo: 'repo' },
        }),
      }),
    }) as never;

  beforeEach(async () => {
    jest.clearAllMocks();
    guard = await Test.createTestingModule({
      providers: [
        RepoScopeGuard,
        Reflector,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Repository), useValue: repositoryRepo },
        { provide: ConfigService, useValue: configService },
      ],
    })
      .compile()
      .then((module) => module.get(RepoScopeGuard));
  });

  it('scopes the production sync route (GithubController.sync)', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-2',
      roles: [UserRole.MAINTAINER],
    });
    repositoryRepo.findOne.mockResolvedValue({
      id: 'repo-uuid-1',
      maintainerId: 'user-1',
    });

    await expect(
      guard.canActivate(contextFor(GithubController, 'sync')),
    ).rejects.toThrow(/assigned to another maintainer/);
  });

  it('is a no-op on an undecorated handler', async () => {
    class PlainController {
      open() {}
    }

    await expect(
      guard.canActivate(contextFor(PlainController, 'open')),
    ).resolves.toBe(true);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });
});
