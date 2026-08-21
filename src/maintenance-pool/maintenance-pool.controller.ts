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
import { IsOptional, IsUUID } from 'class-validator';
import { MaintenancePoolService } from './maintenance-pool.service';
import { CreatePoolDto } from './dto/create-pool.dto';
import { IsMoneyAmount } from '../common/validators/money.validator';
import { IsStellarAddress } from '../common/validators/stellar-address.validator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { UsersService } from '../users/users.service';

class DepositDto {
  @IsMoneyAmount()
  amount: string;

  /**
   * Not permissionless: asserted against the caller's own linked
   * `stellarAddress` below (#40).
   */
  @IsStellarAddress()
  funderAddress: string;
}

class AssignRewardDto {
  @IsMoneyAmount()
  amount: string;

  @IsStellarAddress()
  recipientAddress: string;

  /**
   * Cross-checked against `recipientAddress` in `EscrowService.releasePartial`
   * before any chain call — see `ReleaseEscrowDto.recipientId` (#40).
   */
  @IsOptional()
  @IsUUID()
  recipientId?: string;
}

@ApiTags('maintenance-pool')
@Controller('maintenance-pools')
export class MaintenancePoolController {
  constructor(
    private readonly poolService: MaintenancePoolService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  create(@Body() dto: CreatePoolDto) {
    return this.poolService.create(dto);
  }

  @Get()
  list() {
    return this.poolService.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.poolService.findOne(id);
  }

  /**
   * The funder is the caller: this debits their wallet, so `funderAddress` may
   * only be the address linked to their own account (#40).
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Idempotent('pool.deposit')
  @Post(':id/deposit')
  async deposit(
    @Param('id') id: string,
    @Body() dto: DepositDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.usersService.assertOwnsStellarAddress(
      req.user.userId,
      dto.funderAddress,
    );
    return this.poolService.deposit(id, dto.amount, dto.funderAddress);
  }

  @Idempotent('pool.assignReward')
  @Post(':id/assign-reward')
  assignReward(@Param('id') id: string, @Body() dto: AssignRewardDto) {
    return this.poolService.assignReward(
      id,
      dto.amount,
      dto.recipientAddress,
      dto.recipientId,
    );
  }
}
