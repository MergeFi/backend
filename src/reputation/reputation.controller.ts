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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ReputationService } from './reputation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  REPUTATION_HISTORY_DEFAULT_LIMIT,
  REPUTATION_HISTORY_MAX_LIMIT,
} from './reputation.service';

@ApiTags('reputation')
@Controller('reputation')
export class ReputationController {
  constructor(private readonly reputationService: ReputationService) {}

  private assertCanRecompute(user: AuthenticatedUser, userId: string) {
    if (user.userId !== userId && user.role !== 'MAINTAINER') {
      throw new ForbiddenException(
        'You may only recompute your own reputation data',
      );
    }
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':userId/recompute')
  @ApiOperation({
    summary: 'Trigger on-demand recomputation of contributor reputation snapshot',
    description: 'Requires authentication. Can only be triggered by the contributor or a maintainer.',
  })
  recompute(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertCanRecompute(user, userId);
    return this.reputationService.computeAndSave(userId);
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'Get latest reputation snapshot for a contributor',
    description: 'Publicly readable by sponsors, maintainers, and contributors to evaluate track record.',
  })
  latest(
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.reputationService.getLatest(userId);
  }

  @Get(':userId/history')
  @ApiOperation({
    summary: 'Get historical reputation snapshots for a contributor',
    description: 'Publicly readable history of metrics over time for platform transparency.',
  })
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
