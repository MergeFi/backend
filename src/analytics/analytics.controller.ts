import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { HEATMAP_MAX_DAYS } from '../common/stats/contributor-stats.sql';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ApiInternalErrorResponse } from '../common/swagger/api-common-responses.decorator';

@ApiTags('analytics')
@Controller('analytics')
@ApiInternalErrorResponse()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('contributors/:userId')
  @ApiOperation({
    summary: 'Contributor analytics (SQL-aggregated)',
    description:
      'Lifetime earnings, repo/org counts, merge rate, review time, languages, a UTC calendar-day payout heatmap (capped at 366 most recent days), and top 10 sponsors by spend. Optional from/to (YYYY-MM-DD, UTC) bound the heatmap; the span cannot exceed 366 days.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2023-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2023-12-31' })
  forContributor(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (user.userId !== userId) {
      throw new ForbiddenException(
        'You may only access your own analytics data',
      );
    }
    return this.analyticsService.forContributor(userId, { from, to });
  }

  @Get('platform')
  // Shared caches (CDN) hold one copy for 60s, so every visitor sees the same figure (#788).
  @Header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30')
  @ApiOperation({
    summary: 'Platform-wide homepage summary',
    description: `Served with a 60s shared-cache lifetime so all visitors see the same figure. Heatmap/day cap is ${HEATMAP_MAX_DAYS}.`,
  })
  platformSummary() {
    return this.analyticsService.platformSummary();
  }
}
