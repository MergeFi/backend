import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('contributors/:userId')
  forContributor(@Param('userId') userId: string) {
    return this.analyticsService.forContributor(userId);
  }

  @Get('platform')
  platformSummary() {
    return this.analyticsService.platformSummary();
  }
}
