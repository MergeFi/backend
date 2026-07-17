import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
  async fund(@Body() dto: FundEscrowDto) {
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
