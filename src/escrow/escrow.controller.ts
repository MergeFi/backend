import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EscrowService } from './escrow.service';
import { FundEscrowDto } from './dto/fund-escrow.dto';
import { ReleaseEscrowDto } from './dto/release-escrow.dto';
import { SplitReleaseDto } from './dto/split-release.dto';
import { toPublicEscrow } from './escrow-response.mapper';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { UsersService } from '../users/users.service';

@ApiTags('escrow')
@Controller('escrow')
export class EscrowController {
  constructor(
    private readonly escrowService: EscrowService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * The funder is the caller: this debits their wallet, so `funderAddress` may
   * only be the address linked to their own account (#40).
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Idempotent('escrow.fund')
  @Post('fund')
  async fund(@Body() dto: FundEscrowDto, @Req() req: AuthenticatedRequest) {
    await this.usersService.assertOwnsStellarAddress(
      req.user.userId,
      dto.funderAddress,
    );
    return toPublicEscrow(await this.escrowService.fund(dto));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return toPublicEscrow(await this.escrowService.findOne(id));
  }

  @Idempotent('escrow.release')
  @Post(':id/release')
  async release(@Param('id') id: string, @Body() dto: ReleaseEscrowDto) {
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
  splitRelease(@Param('id') id: string, @Body() dto: SplitReleaseDto) {
    return this.escrowService.splitRelease(id, dto.recipients);
  }

  @Idempotent('escrow.refund')
  @Post(':id/refund')
  async refund(@Param('id') id: string) {
    return toPublicEscrow(await this.escrowService.refund(id));
  }
}
