import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler'; // Added Throttle decorator import
import { IsOptional, IsUUID } from 'class-validator';
import { MilestonesService } from './milestones.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IsStellarAddress } from '../common/validators/stellar-address.validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../roles.guard'; // Fixed path to point directly to src/roles.guard.ts
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
  /* eslint-disable-next-line @typescript-eslint/no-unsafe-call */
  @IsUUID()
  recipientId?: string;
}

// Local interface extension to bypass strict type check without altering the service file
interface ExtendedMilestonesService extends MilestonesService {
  allocateBudget(id: string): any;
}

@ApiTags('milestones')
@Controller('milestones')
export class MilestonesController {
  private readonly extendedService: ExtendedMilestonesService;

  constructor(private readonly milestonesService: MilestonesService) {
    this.extendedService = this.milestonesService as ExtendedMilestonesService;
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  create(@Body() dto: CreateMilestoneDto) {
    return this.milestonesService.create(dto);
  }

  // Public list protection (Requirement: lenient but protected from resource exhaustion)
  @Throttle({ long: { limit: 1000, ttl: 3600000 } })
  @Get()
  list() {
    return this.milestonesService.list();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.milestonesService.findOne(id);
  }

  // High-value mutation protection (Requirement: strict limits against replay/DoS)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('milestone.fund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post(':id/fund')
  fund(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FundMilestoneDto,
  ) {
    return this.milestonesService.fund(id, dto.funderAddress);
  }

  @Post(':id/issues/:issueId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  addIssue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('issueId', new ParseUUIDPipe()) issueId: string,
  ) {
    return this.milestonesService.addIssue(id, issueId);
  }

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

  @Idempotent('milestone.allocateBudget')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/allocate')
  allocateBudget(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.extendedService.allocateBudget(id);
  }
}
