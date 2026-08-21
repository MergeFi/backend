import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReputationService } from './reputation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('reputation')
@Controller('reputation')
export class ReputationController {
  constructor(private readonly reputationService: ReputationService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':userId/recompute')
  recompute(@Param('userId') userId: string) {
    return this.reputationService.computeAndSave(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':userId')
  latest(@Param('userId') userId: string) {
    return this.reputationService.getLatest(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':userId/history')
  history(@Param('userId') userId: string) {
    return this.reputationService.history(userId);
  }
}
