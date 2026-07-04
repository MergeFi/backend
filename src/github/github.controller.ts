import { Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GithubSyncService } from './github-sync.service';

@ApiTags('github')
@Controller('github')
export class GithubController {
  constructor(private readonly syncService: GithubSyncService) {}

  @Post('sync/:owner/:repo')
  sync(@Param('owner') owner: string, @Param('repo') repo: string) {
    return this.syncService.syncRepository(owner, repo);
  }
}
