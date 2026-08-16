import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { BountiesService } from './bounties.service';
import { CreateBountyDto } from './dto/create-bounty.dto';
import { ClaimBountyDto } from './dto/claim-bounty.dto';
import { ListBountiesDto } from './dto/list-bounties.dto';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { PaginatedResponse } from '../common/dto/pagination.dto';
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
  list(@Query() query: ListBountiesDto): Promise<PaginatedResponse<Bounty>> {
    return this.bountiesService.list(query);
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
