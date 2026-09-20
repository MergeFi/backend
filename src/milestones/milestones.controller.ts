import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { MilestonesService } from './milestones.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IsStellarAddress } from '../common/validators/stellar-address.validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';

class FundMilestoneDto {
  @IsStellarAddress()
  funderAddress!: string;
}

class ResolveIssueDto {
  @IsStellarAddress()
  recipientAddress!: string;

  @IsOptional()
  @IsUUID()
  recipientId?: string;
}

@ApiTags('milestones')
@Controller('milestones')
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @ApiOperation({
    summary: 'Create a milestone',
    description:
      'Creates a milestone grouped by issues with a dedicated budget cap. Requires sponsor or maintainer role.',
  })
  create(@Body() dto: CreateMilestoneDto) {
    return this.milestonesService.create(dto);
  }

  @Throttle({ long: { limit: 1000, ttl: 3600000 } })
  @Get()
  @ApiOperation({
    summary: 'List milestones',
    description:
      'Retrieves all project milestones with budget allocations and progress status.',
  })
  list() {
    return this.milestonesService.list();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get milestone details',
    description:
      'Retrieves detailed information, associated issues, and funding status for a single milestone.',
  })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.milestonesService.findOne(id);
  }

  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('milestone.fund')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post(':id/fund')
  @ApiOperation({
    summary: 'Fund a milestone',
    description:
      'Deposits stellar assets into the milestone escrow budget. Requires sponsor or maintainer role.',
  })
  fund(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FundMilestoneDto,
  ) {
    return this.milestonesService.fund(id, dto.funderAddress);
  }

  @Post(':id/issues/:issueId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @ApiOperation({
    summary: 'Attach an issue to a milestone',
    description:
      'Links a tracked issue to an existing milestone for payout tracking. Restricted to maintainers.',
  })
  addIssue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
  ) {
    return this.milestonesService.addIssue(id, issueId);
  }

  @Idempotent('milestone.resolveIssue')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/issues/:issueId/resolve')
  @ApiOperation({
    summary: 'Resolve milestone issue and disburse payment',
    description:
      'Marks a milestone-linked issue as resolved and triggers reward disbursement to recipient. Restricted to maintainers.',
  })
  resolveIssue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
    @Body() dto: ResolveIssueDto,
  ) {
    return this.milestonesService.resolveIssue(
      id,
      issueId,
      dto.recipientAddress,
      dto.recipientId,
    );
  }

  @Idempotent('milestone.allocateBudget')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/allocate')
  @ApiOperation({
    summary: 'Allocate milestone budget',
    description:
      'Recalculates and locks budget shares among attached issues in the milestone. Restricted to maintainers.',
  })
  allocateBudget(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.milestonesService.allocateBudget(id);
  }
}
