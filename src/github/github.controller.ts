import {
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GithubSyncService } from './github-sync.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../common/enums';
import { User } from '../common/entities';

interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('github')
@Controller('github')
export class GithubController {
  constructor(private readonly syncService: GithubSyncService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('sync/:owner/:repo')
  async sync(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Req() req: RequestWithUser,
  ) {
    const user = req.user;
    const isMaintainerOrAdmin =
      user?.roles &&
      (user.roles.includes(UserRole.MAINTAINER) ||
        user.roles.includes(UserRole.SPONSOR) ||
        (user.roles as unknown as string[]).includes('admin'));

    if (!isMaintainerOrAdmin) {
      throw new ForbiddenException(
        'Only maintainers or sponsors may trigger repository synchronization',
      );
    }

    const tracked = await this.syncService.findRepositoryByOwnerAndName(
      owner,
      repo,
    );
    if (!tracked) {
      throw new NotFoundException(
        `Repository ${owner}/${repo} is not tracked by MergeFi. Only registered repositories can be synced.`,
      );
    }

    return this.syncService.syncRepository(owner, repo);
  }
}
