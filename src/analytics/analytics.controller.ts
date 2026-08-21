import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('contributors/:userId')
  forContributor(@Param('userId') userId: string) {
    return this.analyticsService.forContributor(userId);
  }

  @Get('platform')
  platformSummary() {
    return this.analyticsService.platformSummary();
  }
}
