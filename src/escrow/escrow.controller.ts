import { Controller, Post, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler'; // Added Throttle decorator import
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { EscrowService } from './escrow.service';

@ApiTags('escrow')
@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  // High-value mutation protection (Requirement: max 1 req/sec against replay/DoS)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Post(':id/release')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  async releaseEscrow(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.escrowService.release(id, '', ''); // Maps to your underlying service arguments
  }

  // High-value mutation protection (Requirement: max 1 req/sec against replay/DoS)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Post(':id/refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
  async refundEscrow(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.escrowService.refund(id);
  }
}
