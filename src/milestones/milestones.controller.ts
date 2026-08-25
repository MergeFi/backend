import { Controller, Post, Param, Body, UseGuards, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MilestonesService } from './milestones.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { FundMilestoneDto } from './dto/fund-milestone.dto';
import { ResolveIssueDto } from './dto/resolve-issue.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../common/entities/user.entity';

@ApiTags('milestones')
@ApiBearerAuth()
@Controller('milestones')
@UseGuards(JwtAuthGuard)
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new milestone' })
  async create(@Body() createMilestoneDto: CreateMilestoneDto, @CurrentUser() user: User) {
    return this.milestonesService.create(createMilestoneDto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get milestone by ID' })
  async findOne(@Param('id') id: string) {
    return this.milestonesService.findOne(id);
  }

  @Post(':id/fund')
  @Idempotent()
  @ApiOperation({ summary: 'Fund a milestone' })
  async fund(@Param('id') id: string, @Body() fundMilestoneDto: FundMilestoneDto, @CurrentUser() user: User) {
    return this.milestonesService.fund(id, fundMilestoneDto, user);
  }

  @Post(':id/issues/:issueId/resolve')
  @Idempotent()
  @ApiOperation({ summary: 'Resolve an issue in a milestone' })
  async resolveIssue(@Param('id') id: string, @Param('issueId') issueId: string, @Body() resolveIssueDto: ResolveIssueDto, @CurrentUser() user: User) {
    return this.milestonesService.resolveIssue(id, issueId, resolveIssueDto, user);
  }
}
