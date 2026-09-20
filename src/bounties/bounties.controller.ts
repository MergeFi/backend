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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post()
  @ApiOperation({
    summary: 'Create a new bounty',
    description:
      'Creates a bounty attached to a repository issue with designated reward, asset, and difficulty. Requires sponsor or maintainer role.',
  })
  create(@Body() dto: CreateBountyDto) {
    return this.bountiesService.create(dto);
  }

  // Public list: Lenient but protected against resource exhaustion (max 1000/hr)
  @Throttle({ long: { limit: 1000, ttl: 3600000 } })
  @Get()
  @ApiOperation({
    summary: 'List bounties',
    description:
      'Queries and filters open, claimed, and completed bounties by status, difficulty, asset type, repository, or language.',
  })
  list(
    @Query('status', new ParseEnumPipe(BountyStatus, { optional: true }))
    status?: BountyStatus,
    @Query(
      'difficulty',
      new ParseEnumPipe(BountyDifficulty, { optional: true }),
    )
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
  @ApiOperation({
    summary: 'Get bounty by ID',
    description:
      'Retrieves full details and contributor assignment for a specific bounty by UUID.',
  })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.findOne(id);
  }

  // High-value mutation: Strict rate limiting (max 1 req/sec)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('bounty.fund')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post(':id/fund')
  @ApiOperation({
    summary: 'Fund a bounty',
    description:
      'Deposits reward tokens into escrow for a specific bounty. Requires sponsor or maintainer role.',
  })
  fund(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FundBountyDto,
  ) {
    return this.bountiesService.fund(id, dto.funderAddress);
  }

  // High-value mutation: Strict rate limiting (max 1 req/sec)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('bounty.claim')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CONTRIBUTOR)
  @Post(':id/claim')
  @ApiOperation({
    summary: 'Claim a bounty',
    description:
      'Claims an open bounty on behalf of an eligible contributor. Requires contributor role.',
  })
  claim(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ClaimBountyDto,
  ) {
    return this.bountiesService.claim(id, dto.contributorId);
  }

  @Idempotent('bounty.approve')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/approve')
  @ApiOperation({
    summary: 'Approve submitted bounty solution',
    description:
      'Approves a completed bounty submission and initiates escrow release. Restricted to maintainers.',
  })
  approve(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.approve(id);
  }

  @Idempotent('bounty.reject')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/reject')
  @ApiOperation({
    summary: 'Reject bounty submission',
    description:
      'Rejects a submitted solution and returns the bounty to open or in-progress status. Restricted to maintainers.',
  })
  reject(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.reject(id);
  }

  // High-value mutation: Strict rate limiting (max 1 req/sec)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('bounty.refund')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post(':id/refund')
  @ApiOperation({
    summary: 'Refund bounty escrow',
    description:
      'Cancels an unfilled or expired bounty and refunds locked funds to the original sponsor. Requires sponsor or maintainer role.',
  })
  refund(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.refund(id);
  }
}
