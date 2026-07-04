import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EscrowService } from './escrow.service';
import { FundEscrowDto } from './dto/fund-escrow.dto';
import { ReleaseEscrowDto } from './dto/release-escrow.dto';
import { SplitReleaseDto } from './dto/split-release.dto';

@ApiTags('escrow')
@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post('fund')
  fund(@Body() dto: FundEscrowDto) {
    return this.escrowService.fund(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.escrowService.findOne(id);
  }

  @Post(':id/release')
  release(@Param('id') id: string, @Body() dto: ReleaseEscrowDto) {
    return this.escrowService.release(
      id,
      dto.recipientAddress,
      dto.recipientId,
    );
  }

  @Post(':id/split-release')
  splitRelease(@Param('id') id: string, @Body() dto: SplitReleaseDto) {
    return this.escrowService.splitRelease(id, dto.recipients);
  }

  @Post(':id/refund')
  refund(@Param('id') id: string) {
    return this.escrowService.refund(id);
  }
}
