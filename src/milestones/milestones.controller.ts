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
import { IsOptional, IsUUID } from 'class-validator';
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
  funderAddress: string;
}

class ResolveIssueDto {
  @IsStellarAddress()
  recipientAddress: string;

  @IsOptional()
  @IsUUID()
  recipientId?: string;
}

@ApiTags('milestones')
@Controller('milestones')
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  create(@Body() dto: CreateMilestoneDto) {
    return this.milestonesService.create(dto);
  }

  @Get()
  list() {
    return this.milestonesService.list();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.milestonesService.findOne(id);
  }

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
}
