import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReputationService } from './reputation.service';

@ApiTags('reputation')
@Controller('reputation')
export class ReputationController {
  constructor(private readonly reputationService: ReputationService) {}

  @Post(':userId/recompute')
  recompute(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.reputationService.computeAndSave(userId);
  }

  @Get(':userId')
  latest(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.reputationService.getLatest(userId);
  }

  @Get(':userId/history')
  history(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.reputationService.history(userId);
  }
}
