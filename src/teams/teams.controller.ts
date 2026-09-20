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
import { CreateTeamDto, TeamMemberSplitDto } from './dto/create-team.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
  @ApiOperation({
    summary: 'Create a development team',
    description:
      'Creates a new team with member payout distribution splits. Requires maintainer or sponsor role.',
  })
  create(@Body() dto: CreateTeamDto) {
    return this.teamsService.create(dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get team details',
    description:
      'Retrieves membership, assigned bounties, and split ratios for a team by UUID.',
  })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.teamsService.findOne(id);
  }

  @Patch(':id/splits')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
  @ApiOperation({
    summary: 'Update team revenue splits',
    description:
      'Updates percentage split allocations across members of the designated team. Requires maintainer or sponsor role.',
  })
  updateSplits(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() members: TeamMemberSplitDto[],
  ) {
    return this.teamsService.updateSplits(id, members);
  }

  @Post(':id/assign/:bountyId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
  @ApiOperation({
    summary: 'Assign team to a bounty',
    description:
      'Binds an entire team to a bounty for shared payout distribution upon completion. Requires maintainer or sponsor role.',
  })
  assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('bountyId', new ParseUUIDPipe()) bountyId: string,
  ) {
    return this.teamsService.assignToBounty(id, bountyId);
  }
}
