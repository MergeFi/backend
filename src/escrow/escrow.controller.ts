import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { EscrowService } from './escrow.service';
import { FundEscrowDto } from './dto/fund-escrow.dto';
import { ReleaseEscrowDto } from './dto/release-escrow.dto';
import { SplitReleaseDto } from './dto/split-release.dto';
import { toPublicEscrow } from './escrow-response.mapper';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import {
  ApiInternalErrorResponse,
  ApiStandardErrorResponses,
} from '../common/swagger/api-common-responses.decorator';

@ApiTags('escrow')
@Controller('escrow')
@ApiInternalErrorResponse()
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @ApiOperation({ summary: 'Fund a new escrow' })
  @ApiStandardErrorResponses()
  @Idempotent('escrow.fund')
  @Post('fund')
  async fund(@Body() dto: FundEscrowDto) {
    return toPublicEscrow(await this.escrowService.fund(dto));
  }

  @ApiOperation({ summary: 'Get an escrow by id' })
  @ApiStandardErrorResponses()
  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return toPublicEscrow(await this.escrowService.findOne(id));
  }

  @ApiOperation({
    summary: 'Release an escrow to its recipient',
    description: 'Rate-limited to 1 request/second to protect against replay/DoS.',
  })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  // High-value mutation protection (Requirement: max 1 req/sec against replay/DoS)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('escrow.release')
  @Post(':id/release')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  async release(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReleaseEscrowDto,
  ) {
    return toPublicEscrow(
      await this.escrowService.release(
        id,
        dto.recipientAddress,
        dto.recipientId,
      ),
    );
  }

  @ApiOperation({
    summary: 'Release an escrow split across multiple recipients',
    description:
      'Recipient percentages must sum to 100 and every recipient must be distinct (#358).',
  })
  @ApiStandardErrorResponses()
  @Idempotent('escrow.splitRelease')
  @Post(':id/split-release')
  splitRelease(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SplitReleaseDto,
  ) {
    return this.escrowService.splitRelease(id, dto.recipients);
  }

  @ApiOperation({
    summary: 'Refund an escrow to its original funder',
    description: 'Rate-limited to 1 request/second to protect against replay/DoS.',
  })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  // High-value mutation protection (Requirement: max 1 req/sec against replay/DoS)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('escrow.refund')
  @Post(':id/refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
  async refund(@Param('id', new ParseUUIDPipe()) id: string) {
    return toPublicEscrow(await this.escrowService.refund(id));
  }
}
