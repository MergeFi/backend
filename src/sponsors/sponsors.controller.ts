import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SponsorsService } from './sponsors.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ApiInternalErrorResponse } from '../common/swagger/api-common-responses.decorator';

const MAX_PAGE_LIMIT = 100;

function validatePage(limit?: number, offset?: number) {
  if (limit !== undefined && (limit < 1 || limit > MAX_PAGE_LIMIT)) {
    throw new BadRequestException(`limit must be between 1 and ${MAX_PAGE_LIMIT}`);
  }
  if (offset !== undefined && offset < 0) {
    throw new BadRequestException('offset must be >= 0');
  }
  return { limit, offset };
}

@ApiTags('sponsors')
@Controller('sponsors')
@ApiInternalErrorResponse()
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
    // #280 — reject NaN/negative/fractional values and cap the page size.
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ) {
    this.assertOwnsSponsor(user, id);
    return this.sponsorsService.dashboard(id, validatePage(limit, offset));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/milestones/progress')
  milestoneProgress(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
    // #280 — reject NaN/negative/fractional values and cap the page size.
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ) {
    this.assertOwnsSponsor(user, id);
    return this.sponsorsService.milestoneProgress(
      id,
      validatePage(limit, offset),
    );
  }
}
