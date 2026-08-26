import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReputationService } from './reputation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('reputation')
@Controller('reputation')
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
  latest(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertOwner(user, userId);
    return this.reputationService.getLatest(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':userId/history')
  history(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertOwner(user, userId);
    return this.reputationService.history(userId);
  }
}
