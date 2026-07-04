import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SponsorsService } from './sponsors.service';

@ApiTags('sponsors')
@Controller('sponsors')
export class SponsorsController {
  constructor(private readonly sponsorsService: SponsorsService) {}

  @Get(':id/dashboard')
  dashboard(@Param('id') id: string) {
    return this.sponsorsService.dashboard(id);
  }

  @Get(':id/milestones/progress')
  milestoneProgress(@Param('id') id: string) {
    return this.sponsorsService.milestoneProgress(id);
  }
}
