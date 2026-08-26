import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SponsorsService } from './sponsors.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('sponsors')
@Controller('sponsors')
export class SponsorsController {
  constructor(private readonly sponsorsService: SponsorsService) {}

  private assertOwnsSponsor(user: AuthenticatedUser, sponsorId: string) {
    if (user.userId !== sponsorId) {
      throw new ForbiddenException(
        'You may only view your own sponsor dashboard and progress',
      );
    }
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/dashboard')
  dashboard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertOwnsSponsor(user, id);
    return this.sponsorsService.dashboard(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/milestones/progress')
  milestoneProgress(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertOwnsSponsor(user, id);
    return this.sponsorsService.milestoneProgress(id);
  }
}
