import { Controller, Post, Param, Body, UseGuards, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../common/entities/user.entity';

@ApiTags('teams')
@ApiBearerAuth()
@Controller('teams')
@UseGuards(JwtAuthGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new team' })
  async create(@Body() createTeamDto: CreateTeamDto, @CurrentUser() user: User) {
    return this.teamsService.create(createTeamDto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get team by ID' })
  async findOne(@Param('id') id: string) {
    return this.teamsService.findOne(id);
  }

  @Post(':id/assign/:bountyId')
  @Idempotent()
  @ApiOperation({ summary: 'Assign team to bounty' })
  async assignToBounty(@Param('id') id: string, @Param('bountyId') bountyId: string, @CurrentUser() user: User) {
    return this.teamsService.assignToBounty(id, bountyId, user);
  }
}
