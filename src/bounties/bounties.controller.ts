import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiQuery } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { BountiesService } from './bounties.service';
import { CreateBountyDto } from './dto/create-bounty.dto';
import { ClaimBountyDto } from './dto/claim-bounty.dto';
import { BountyStatus } from '../common/enums';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { Bounty } from '../common/entities';

class FundBountyDto {
  @IsString()
  funderAddress: string;
}

@ApiTags('bounties')
@Controller('bounties')
export class BountiesController {
  constructor(private readonly bountiesService: BountiesService) {}

  @Post()
  create(@Body() dto: CreateBountyDto) {
    return this.bountiesService.create(dto);
  }

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: BountyStatus })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query('status') status?: BountyStatus,
    @Query() paginationQuery?: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<Bounty>> {
    const page = paginationQuery?.page || 1;
    const limit = paginationQuery?.limit || 50;
    const { data, total } = await this.bountiesService.list(status, page, limit);
    return new PaginatedResponseDto(data, page, limit, total);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bountiesService.findOne(id);
  }

  @Idempotent('bounty.fund')
  @Post(':id/fund')
  fund(@Param('id') id: string, @Body() dto: FundBountyDto) {
    return this.bountiesService.fund(id, dto.funderAddress);
  }

  @Idempotent('bounty.claim')
  @Post(':id/claim')
  claim(@Param('id') id: string, @Body() dto: ClaimBountyDto) {
    return this.bountiesService.claim(id, dto.contributorId);
  }

  @Idempotent('bounty.refund')
  @Post(':id/refund')
  refund(@Param('id') id: string) {
    return this.bountiesService.refund(id);
  }
}
