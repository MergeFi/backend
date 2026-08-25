import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BountiesService } from './bounties.service';
import { CreateBountyDto } from './dto/create-bounty.dto';
import { ClaimBountyDto } from './dto/claim-bounty.dto';
import { BountyStatus } from '../common/enums';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IsStellarAddress } from '../common/validators/stellar-address.validator';

class FundBountyDto {
  @IsStellarAddress()
  funderAddress: string;
}

@ApiTags('bounties')
@Controller('bounties')
export class BountiesController {
  constructor(private readonly bountiesService: BountiesService) {}

  @Idempotent('bounty.create')
  @Post()
  create(@Body() dto: CreateBountyDto) {
    return this.bountiesService.create(dto);
  }

  @Get()
  list(@Query('status', new ParseEnumPipe(BountyStatus, { optional: true })) status?: BountyStatus) {
    return this.bountiesService.list(status);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.findOne(id);
  }

  @Idempotent('bounty.fund')
  @Post(':id/fund')
  fund(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: FundBountyDto) {
    return this.bountiesService.fund(id, dto.funderAddress);
  }

  @Idempotent('bounty.claim')
  @Post(':id/claim')
  claim(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ClaimBountyDto) {
    return this.bountiesService.claim(id, dto.contributorId);
  }

  @Idempotent('bounty.refund')
  @Post(':id/refund')
  refund(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.refund(id);
  }
}
