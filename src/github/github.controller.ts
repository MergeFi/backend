import { Controller, DefaultValuePipe, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiTags, ApiQuery } from '@nestjs/swagger';
import { GithubSyncService } from './github-sync.service';

@ApiTags('github')
@Controller('github')
export class GithubController {
  constructor(private readonly syncService: GithubSyncService) {}

  @Post('sync/:owner/:repo')
  @ApiQuery({ name: 'page', required: false, type: Number })
  sync(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    return this.syncService.syncRepository(owner, repo, page);
  }
}
