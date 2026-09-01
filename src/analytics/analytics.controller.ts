import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { HEATMAP_MAX_DAYS } from '../common/stats/contributor-stats.sql';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

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
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.forContributor(userId, { from, to });
  }

  @Get('platform')
  @ApiOperation({
    summary: 'Platform-wide homepage summary',
    description: `Cached in-process for ANALYTICS_PLATFORM_SUMMARY_TTL_MS (default 60s). Invalidated when a bounty is created or paid, or a repository is first synced. Heatmap/day cap is ${HEATMAP_MAX_DAYS}. Multi-instance deployments may serve up to one TTL of stale data per process.`,
  })
  platformSummary() {
    return this.analyticsService.platformSummary();
  }
}
