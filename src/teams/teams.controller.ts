import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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
  findOne(@Param('id') id: string) {
    return this.teamsService.findOne(id);
  }

  @Patch(':id/splits')
  updateSplits(
    @Param('id') id: string,
    @Body() members: TeamMemberSplitDto[],
  ) {
    return this.teamsService.updateSplits(id, members);
  }

  @Post(':id/assign/:bountyId')
  assign(@Param('id') id: string, @Param('bountyId') bountyId: string) {
    return this.teamsService.assignToBounty(id, bountyId);
  }
}
