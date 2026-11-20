import {
  Controller,
  DefaultValuePipe,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler'; // Added Throttle decorator import
import { GithubSyncService } from './github-sync.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RepoScopedSync } from '../auth/decorators/repo-scoped-sync.decorator';
import { RepoScopeGuard } from '../auth/guards/repo-scope.guard';
import { UserRole } from '../common/enums';
import { ApiInternalErrorResponse } from '../common/swagger/api-common-responses.decorator';

@ApiTags('github')
@Controller('github')
@ApiInternalErrorResponse()
export class GithubController {
  constructor(private readonly syncService: GithubSyncService) {}

  // #62 — this endpoint triggers a full repository sync (writes + GitHub API
  // calls under this server's credentials) and was completely unauthenticated.
  // Restricted to authenticated maintainers.
  // Mutation Protection: Stricter rate limits against automation DoS flooding.
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Post('sync/:owner/:repo')
  @ApiBearerAuth()
  @ApiQuery({ name: 'page', required: false, type: Number })
  @UseGuards(JwtAuthGuard, RolesGuard, RepoScopeGuard)
  @Roles(UserRole.MAINTAINER)
  // #312 — MAINTAINER is platform-wide; RepoScopeGuard additionally requires
  // that the caller is this repository's recorded maintainer, or is allowlisted
  // to introduce it, so the shared Octokit token can't be spent syncing
  // unrelated public repositories.
  @RepoScopedSync()
  async sync(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Req() req: Request,
  ) {
    const result = await this.syncService.syncRepository(owner, repo, page);
    // First claim of an unclaimed repository, recorded only after the sync
    // succeeded (#776).
    const claim = (req as Request & { repoClaim?: { repositoryId: string; userId: string } }).repoClaim;
    if (claim) {
      await this.syncService.claimRepository(claim.repositoryId, claim.userId);
    }
    return result;
  }
}
