import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
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
import { Request } from 'express';
import {
  ApiInternalErrorResponse,
  ApiStandardErrorResponses,
} from '../common/swagger/api-common-responses.decorator';

class FundBountyDto {
  @ApiProperty()
  @IsStellarAddress()
  funderAddress: string;
}

@ApiTags('bounties')
@Controller('bounties')
@ApiInternalErrorResponse()
export class BountiesController {
  constructor(private readonly bountiesService: BountiesService) {}

  @ApiOperation({ summary: 'Create a bounty' })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Idempotent('bounty.create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post()
  create(@Body() dto: CreateBountyDto, @Req() req: Request) {
    const userId = (req.user as any).userId;
    return this.bountiesService.create(dto, userId);
  }

  @ApiOperation({
    summary: 'List bounties',
    description: 'Public endpoint, rate-limited to 1000 requests/hour.',
  })
  // Public list: Lenient but protected against resource exhaustion (max 1000/hr)
  @Throttle({ long: { limit: 1000, ttl: 3600000 } })
  @Get()
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
    @Query(
      'repositoryId',
      new ParseUUIDPipe({ version: '4', optional: true }),
    )
    repositoryId?: string,
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

  @ApiOperation({ summary: 'Get a bounty by id' })
  @ApiStandardErrorResponses()
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.findOne(id);
  }

  @ApiOperation({
    summary: 'Fund a bounty',
    description: 'Rate-limited to 1 request/second.',
  })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  // High-value mutation: Strict rate limiting (max 1 req/sec)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('bounty.fund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post(':id/fund')
  fund(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FundBountyDto,
    @Req() req: Request,
  ) {
    const userId = (req.user as any).userId;
    return this.bountiesService.fund(id, dto.funderAddress, userId);
  }

  @ApiOperation({
    summary: 'Claim a bounty',
    description: 'Rate-limited to 1 request/second.',
  })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  // High-value mutation: Strict rate limiting (max 1 req/sec)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('bounty.claim')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CONTRIBUTOR)
  @Post(':id/claim')
  claim(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    const userId = (req.user as any).userId;
    return this.bountiesService.claim(id, userId);
  }

  @ApiOperation({ summary: 'Approve a claimed bounty' })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Idempotent('bounty.approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/approve')
  approve(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.approve(id);
  }

  @ApiOperation({ summary: 'Reject a claimed bounty' })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Idempotent('bounty.reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/reject')
  reject(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bountiesService.reject(id);
  }

  @ApiOperation({
    summary: 'Refund a bounty to its funder',
    description: 'Rate-limited to 1 request/second.',
  })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  // High-value mutation: Strict rate limiting (max 1 req/sec)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('bounty.refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post(':id/refund')
  refund(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request) {
    const userId = (req.user as any).userId;
    return this.bountiesService.refund(id, userId);
  }
}
