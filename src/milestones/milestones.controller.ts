import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
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
import { Request } from 'express';
import {
  ApiInternalErrorResponse,
  ApiStandardErrorResponses,
} from '../common/swagger/api-common-responses.decorator';

class FundMilestoneDto {
  @ApiProperty()
  @IsStellarAddress()
  funderAddress!: string;
}

class ResolveIssueDto {
  @ApiProperty()
  @IsStellarAddress()
  recipientAddress!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  recipientId?: string;
}

@ApiTags('milestones')
@Controller('milestones')
@ApiInternalErrorResponse()
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @ApiOperation({ summary: 'Create a milestone' })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Idempotent('milestone.create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post()
  create(@Body() dto: CreateMilestoneDto, @Req() req: Request) {
    const userId = (req.user as any).userId;
    return this.milestonesService.create(dto, userId);
  }

  @ApiOperation({ summary: 'List milestones' })
  @Throttle({ long: { limit: 1000, ttl: 3600000 } })
  @Get()
  list() {
    return this.milestonesService.list();
  }

  @ApiOperation({ summary: 'Get a milestone by id' })
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.milestonesService.findOne(id);
  }

  @ApiOperation({ summary: 'Fund a milestone' })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('milestone.fund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post(':id/fund')
  fund(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FundMilestoneDto,
    @Req() req: Request,
  ) {
    const userId = (req.user as any).userId;
    return this.milestonesService.fund(id, dto.funderAddress, userId);
  }

  @ApiOperation({ summary: 'Attach an issue to a milestone' })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Post(':id/issues/:issueId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  addIssue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
  ) {
    return this.milestonesService.addIssue(id, issueId);
  }

  @ApiOperation({
    summary: 'Resolve a milestone issue and pay out the recipient',
  })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Idempotent('milestone.resolveIssue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/issues/:issueId/resolve')
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

  @ApiOperation({ summary: 'Allocate the milestone budget' })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Idempotent('milestone.allocateBudget')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/allocate')
  allocateBudget(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.milestonesService.allocateBudget(id);
  }
}
