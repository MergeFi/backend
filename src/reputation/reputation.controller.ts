import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ReputationService } from './reputation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ApiInternalErrorResponse } from '../common/swagger/api-common-responses.decorator';
import {
  REPUTATION_HISTORY_DEFAULT_LIMIT,
  REPUTATION_HISTORY_MAX_LIMIT,
} from './reputation.service';

@ApiTags('reputation')
@Controller('reputation')
@ApiInternalErrorResponse()
export class ReputationController {
  constructor(private readonly reputationService: ReputationService) {}

  private assertOwner(user: AuthenticatedUser, userId: string) {
    if (user.userId !== userId) {
      throw new ForbiddenException(
        'You may only access or recompute your own reputation data',
      );
    }
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  // Unthrottled, every call ran the multi-join stats SQL AND inserted a row —
  // ~170k snapshots/day from one user (#584). Tight limit + the service skips
  // the insert when nothing changed.
  @Throttle({ long: { limit: 10, ttl: 3_600_000 } })
  @Post(':userId/recompute')
  recompute(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertOwner(user, userId);
    return this.reputationService.computeAndSave(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':userId')
  latest(@Param('userId', new ParseUUIDPipe()) userId: string) {
    // Reputation is a contributor's public track record — a sponsor or
    // maintainer needs to read it before assigning a bounty/team (#583).
    // Any authenticated user may read; only recompute stays owner-gated.
    return this.reputationService.getLatest(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':userId/history')
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Default ${REPUTATION_HISTORY_DEFAULT_LIMIT}, max ${REPUTATION_HISTORY_MAX_LIMIT}`,
  })
  @ApiQuery({ name: 'offset', required: false })
  history(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // Public read — sponsors/maintainers see a contributor's track record
    // before assigning work (#583). Only recompute is owner-gated.
    return this.reputationService.history(userId, {
      limit: parseOptionalInt(limit),
      offset: parseOptionalInt(offset),
    });
  }
}

function parseOptionalInt(value?: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}
