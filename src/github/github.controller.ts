import {
  Controller,
  DefaultValuePipe,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { GithubSyncService } from './github-sync.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';

@ApiTags('github')
@Controller('github')
export class GithubController {
  constructor(private readonly syncService: GithubSyncService) {}

  // #62 — this endpoint triggers a full repository sync (writes + GitHub API
  // calls under this server's credentials) and was completely unauthenticated.
  // Restricted to authenticated maintainers.
  @Post('sync/:owner/:repo')
  @ApiBearerAuth()
  @ApiQuery({ name: 'page', required: false, type: Number })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  sync(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    return this.syncService.syncRepository(owner, repo, page);
  }
}
