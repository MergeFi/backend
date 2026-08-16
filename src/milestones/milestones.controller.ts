import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiQuery } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { MilestonesService } from './milestones.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { Milestone } from '../common/entities';

class FundMilestoneDto {
  @IsString()
  funderAddress: string;
}

class ResolveIssueDto {
  @IsString()
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
  create(@Body() dto: CreateMilestoneDto) {
    return this.milestonesService.create(dto);
  }

  @Get()
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query() paginationQuery?: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<Milestone>> {
    const page = paginationQuery?.page || 1;
    const limit = paginationQuery?.limit || 50;
    const { data, total } = await this.milestonesService.list(page, limit);
    return new PaginatedResponseDto(data, page, limit, total);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.milestonesService.findOne(id);
  }

  @Idempotent('milestone.fund')
  @Post(':id/fund')
  fund(@Param('id') id: string, @Body() dto: FundMilestoneDto) {
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
