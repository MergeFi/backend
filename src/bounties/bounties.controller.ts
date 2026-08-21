import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BountiesService } from './bounties.service';
import { CreateBountyDto } from './dto/create-bounty.dto';
import { BountyStatus } from '../common/enums';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IsStellarAddress } from '../common/validators/stellar-address.validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { UsersService } from '../users/users.service';

class FundBountyDto {
  @IsStellarAddress()
  funderAddress: string;
}

@ApiTags('bounties')
@Controller('bounties')
export class BountiesController {
  constructor(
    private readonly bountiesService: BountiesService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  create(@Body() dto: CreateBountyDto) {
    return this.bountiesService.create(dto);
  }

  @Get()
  list(@Query('status') status?: BountyStatus) {
    return this.bountiesService.list(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bountiesService.findOne(id);
  }

  /**
   * The funder is the caller: this debits their wallet, so `funderAddress` may
   * only be the address linked to their own account (#40).
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Idempotent('bounty.fund')
  @Post(':id/fund')
  async fund(
    @Param('id') id: string,
    @Body() dto: FundBountyDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.usersService.assertOwnsStellarAddress(
      req.user.userId,
      dto.funderAddress,
    );
    return this.bountiesService.fund(id, dto.funderAddress);
  }

  /**
   * Claiming is first-person only. The contributor is read from the verified
   * token, never from the body — `CLAIMED` is a one-way gate in the bounty
   * state machine, so a client-supplied contributor id let any caller burn
   * another user's claim (or point the eventual payout at them) (#40).
   *
   * There is deliberately no "claim on behalf of" path here. If maintainer-side
   * assignment is wanted later it needs its own route and its own authorization
   * check, not a field on this one.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Idempotent('bounty.claim')
  @Post(':id/claim')
  claim(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.bountiesService.claim(id, req.user.userId);
  }

  @Idempotent('bounty.refund')
  @Post(':id/refund')
  refund(@Param('id') id: string) {
    return this.bountiesService.refund(id);
  }
}
