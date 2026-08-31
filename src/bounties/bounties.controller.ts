import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler'; // Import the Throttle decorator
import { BountiesService } from './bounties.service';
import { CreateBountyDto } from './dto/create-bounty.dto';
import { ClaimBountyDto } from './dto/claim-bounty.dto';
import { AssetType, BountyDifficulty, BountyStatus } from '../common/enums';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { IsStellarAddress } from '../common/validators/stellar-address.validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';

class FundBountyDto {
  @IsStellarAddress()
  funderAddress: string;
}

@ApiTags('bounties')
@Controller('bounties')
export class BountiesController {
  constructor(private readonly bountiesService: BountiesService) {}

  @Idempotent('bounty.create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post()
  create(@Body() dto: CreateBountyDto) {
    return this.bountiesService.create(dto);
  }

  // Public list: Lenient but protected against resource exhaustion (max 1000/hr)
  @Throttle({ long: { limit: 1000, ttl: 3600000 } })
  @Get()
  list(
    @Query('status', new ParseEnumPipe(BountyStatus, { optional: true }))
    status?: BountyStatus,
    @Query('difficulty', new ParseEnumPipe(BountyDifficulty, { optional: true }))
    difficulty?: BountyDifficulty,
    @Query('asset', new ParseEnumPipe(AssetType, { optional: true }))
    asset?: AssetType,
    @Query('repositoryId') repositoryId?: string,
    @Query('primaryLanguage') primaryLanguage?: string,
  ) {
    return this.bountiesService.list({
      status,
      difficulty,
      asset,
      repositoryId,
      primaryLanguage,
    });
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.findOne(id);
  }

  // High-value mutation: Strict rate limiting (max 1 req/sec)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('bounty.fund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post(':id/fund')
  fund(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FundBountyDto,
  ) {
    return this.bountiesService.fund(id, dto.funderAddress);
  }

  // High-value mutation: Strict rate limiting (max 1 req/sec)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('bounty.claim')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CONTRIBUTOR)
  @Post(':id/claim')
  claim(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ClaimBountyDto,
  ) {
    return this.bountiesService.claim(id, dto.contributorId);
  }

  @Idempotent('bounty.approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/approve')
  approve(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.approve(id);
  }

  @Idempotent('bounty.reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/reject')
  reject(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.reject(id);
  }

  // High-value mutation: Strict rate limiting (max 1 req/sec)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('bounty.refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post(':id/refund')
  refund(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bundlesService.refund(id);
  }
}
