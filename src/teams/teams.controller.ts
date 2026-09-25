import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { CreateTeamDto, UpdateTeamSplitsDto } from './dto/create-team.dto';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import {
  ApiInternalErrorResponse,
  ApiStandardErrorResponses,
} from '../common/swagger/api-common-responses.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

@ApiTags('teams')
@Controller('teams')
@ApiInternalErrorResponse()
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @ApiOperation({
    summary: 'Create a team with member payout splits',
    description:
      'Splits must be non-empty, each in (0, 100], sum to 100 (within tolerance), and reference distinct users (#358).',
  })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Idempotent('team.create')
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
  create(@Body() dto: CreateTeamDto) {
    return this.teamsService.create(dto);
  }

  @ApiOperation({ summary: 'Get a team and its current member splits' })
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.teamsService.findOne(id);
  }

  @ApiOperation({
    summary: 'Replace a team\'s member payout splits',
    description: 'Same validation as create: unique members, splits sum to 100.',
  })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Idempotent('team.updateSplits')
  @Patch(':id/splits')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
  updateSplits(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTeamSplitsDto,
  ) {
    return this.teamsService.updateSplits(id, dto.splits);
  }

  @ApiOperation({ summary: 'Assign a team to work a bounty' })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Idempotent('team.assign')
  @Post(':id/assign/:bountyId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
  assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('bountyId', new ParseUUIDPipe()) bountyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teamsService.assignToBounty(id, bountyId, user.userId);
  }
}
