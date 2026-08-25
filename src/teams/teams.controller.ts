import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { CreateTeamDto, TeamMemberSplitDto } from './dto/create-team.dto';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  create(@Body() dto: CreateTeamDto) {
    return this.teamsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.teamsService.findOne(id);
  }

  @Patch(':id/splits')
  updateSplits(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() members: TeamMemberSplitDto[],
  ) {
    return this.teamsService.updateSplits(id, members);
  }

  @Post(':id/assign/:bountyId')
  assign(@Param('id', new ParseUUIDPipe()) id: string, @Param('bountyId', new ParseUUIDPipe()) bountyId: string) {
    return this.teamsService.assignToBounty(id, bountyId);
  }
}
