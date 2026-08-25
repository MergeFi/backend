import { Controller, Post, Param, Body, UseGuards, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EscrowService } from './escrow.service';
import { FundEscrowDto } from './dto/fund-escrow.dto';
import { ReleaseEscrowDto } from './dto/release-escrow.dto';
import { SplitReleaseDto } from './dto/split-release.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../common/entities/user.entity';

@ApiTags('escrow')
@ApiBearerAuth()
@Controller('escrow')
@UseGuards(JwtAuthGuard)
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post('fund')
  @Idempotent()
  @ApiOperation({ summary: 'Fund an escrow' })
  async fund(@Body() fundEscrowDto: FundEscrowDto, @CurrentUser() user: User) {
    return this.escrowService.fund(fundEscrowDto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get escrow by ID' })
  async findOne(@Param('id') id: string) {
    return this.escrowService.findOne(id);
  }

  @Post(':id/release')
  @Idempotent()
  @ApiOperation({ summary: 'Release escrow funds' })
  async release(@Param('id') id: string, @Body() releaseEscrowDto: ReleaseEscrowDto, @CurrentUser() user: User) {
    return this.escrowService.release(id, releaseEscrowDto, user);
  }

  @Post(':id/split-release')
  @Idempotent()
  @ApiOperation({ summary: 'Split release escrow funds' })
  async splitRelease(@Param('id') id: string, @Body() splitReleaseDto: SplitReleaseDto, @CurrentUser() user: User) {
    return this.escrowService.splitRelease(id, splitReleaseDto, user);
  }

  @Post(':id/refund')
  @Idempotent()
  @ApiOperation({ summary: 'Refund escrow' })
  async refund(@Param('id') id: string, @CurrentUser() user: User) {
    return this.escrowService.refund(id, user);
  }
}
