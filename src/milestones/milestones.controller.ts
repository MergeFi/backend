import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { MilestonesService } from './milestones.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IsStellarAddress } from '../common/validators/stellar-address.validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { UsersService } from '../users/users.service';

class FundMilestoneDto {
  /**
   * Not permissionless: asserted against the caller's own linked
   * `stellarAddress` below (#40).
   */
  @IsStellarAddress()
  funderAddress: string;
}

class ResolveIssueDto {
  @IsStellarAddress()
  recipientAddress: string;

  /**
   * Cross-checked against `recipientAddress` in `EscrowService.releasePartial`
   * before any chain call — see `ReleaseEscrowDto.recipientId` (#40).
   */
  @IsOptional()
  @IsUUID()
  recipientId?: string;
}

@ApiTags('milestones')
@Controller('milestones')
export class MilestonesController {
  constructor(
    private readonly milestonesService: MilestonesService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  create(@Body() dto: CreateMilestoneDto) {
    return this.milestonesService.create(dto);
  }

  @Get()
  list() {
    return this.milestonesService.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.milestonesService.findOne(id);
  }

  /**
   * The funder is the caller: this debits their wallet, so `funderAddress` may
   * only be the address linked to their own account (#40).
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Idempotent('milestone.fund')
  @Post(':id/fund')
  async fund(
    @Param('id') id: string,
    @Body() dto: FundMilestoneDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.usersService.assertOwnsStellarAddress(
      req.user.userId,
      dto.funderAddress,
    );
    return this.milestonesService.fund(id, dto.funderAddress);
  }

  @Post(':id/issues/:issueId')
  addIssue(@Param('id') id: string, @Param('issueId') issueId: string) {
    return this.milestonesService.addIssue(id, issueId);
  }

  @Idempotent('milestone.resolveIssue')
  @Post(':id/issues/:issueId/resolve')
  resolveIssue(
    @Param('id') id: string,
    @Param('issueId') issueId: string,
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
