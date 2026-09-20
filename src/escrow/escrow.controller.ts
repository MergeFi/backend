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

@ApiTags('escrow')
@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Idempotent('escrow.fund')
  @Post('fund')
  @ApiOperation({
    summary: 'Fund an escrow account',
    description:
      'Deposits funds into the specified escrow account on-chain and updates escrow status to funded.',
  })
  async fund(@Body() dto: FundEscrowDto) {
    return toPublicEscrow(await this.escrowService.fund(dto));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get escrow details',
    description:
      'Retrieves the public details and status of an escrow account by its unique ID.',
  })
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return toPublicEscrow(await this.escrowService.findOne(id));
  }

  // High-value mutation protection (Requirement: max 1 req/sec against replay/DoS)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('escrow.release')
  @Post(':id/release')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @ApiOperation({
    summary: 'Release escrow funds to recipient',
    description:
      'Releases locked escrow funds to a single designated recipient address. Restricted to maintainers.',
  })
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

  @Idempotent('escrow.splitRelease')
  @Post(':id/split-release')
  @ApiOperation({
    summary: 'Split and release escrow funds',
    description:
      'Releases locked escrow funds split across multiple recipients according to configured split percentages.',
  })
  splitRelease(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SplitReleaseDto,
  ) {
    return this.escrowService.splitRelease(id, dto.recipients);
  }

  // High-value mutation protection (Requirement: max 1 req/sec against replay/DoS)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('escrow.refund')
  @Post(':id/refund')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
  @ApiOperation({
    summary: 'Refund escrow funds to sponsor',
    description:
      'Refunds unreleased escrow funds back to the funder. Restricted to maintainers and sponsors.',
  })
  async refund(@Param('id', new ParseUUIDPipe()) id: string) {
    return toPublicEscrow(await this.escrowService.refund(id));
  }
}
