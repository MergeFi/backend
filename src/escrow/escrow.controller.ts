import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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

  @UseGuards(JwtAuthGuard)
  @Idempotent('escrow.fund')
  @Post('fund')
  async fund(@Body() dto: FundEscrowDto) {
    return toPublicEscrow(await this.escrowService.fund(dto));
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return toPublicEscrow(await this.escrowService.findOne(id));
  }

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

  @Idempotent('escrow.splitRelease')
  @Post(':id/split-release')
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
  async refund(@Param('id', new ParseUUIDPipe()) id: string) {
    return toPublicEscrow(await this.escrowService.refund(id));
  }
}
