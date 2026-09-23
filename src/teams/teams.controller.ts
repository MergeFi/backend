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
import { ApiTags } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { CreateTeamDto, UpdateTeamSplitsDto } from './dto/create-team.dto';
import { CreateTeamDto, TeamMemberSplitDto } from './dto/create-team.dto';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Idempotent('team.create')
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
  create(@Body() dto: CreateTeamDto) {
    return this.teamsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.teamsService.findOne(id);
  }

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
