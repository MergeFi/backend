import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsUUID } from 'class-validator';
import { MaintenancePoolService } from './maintenance-pool.service';
import { CreatePoolDto } from './dto/create-pool.dto';
import { IsMoneyAmount } from '../common/validators/money.validator';
import { IsStellarAddress } from '../common/validators/stellar-address.validator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';

class DepositDto {
  @ApiProperty({ description: 'Amount to deposit into the maintenance pool' })
  @IsMoneyAmount()
  amount: string;

  @ApiProperty({ description: 'Stellar public key of the funder depositing into the pool' })
  @IsStellarAddress()
  funderAddress: string;
}

class AssignRewardDto {
  @ApiProperty({ description: 'ID of the issue being rewarded' })
  @IsUUID()
  issueId: string;

  @ApiProperty({ description: 'Reward amount allocated from the maintenance pool' })
  @IsMoneyAmount()
  amount: string;

  @ApiProperty({ description: 'Stellar public key of the reward recipient' })
  @IsStellarAddress()
  recipientAddress: string;

  @ApiProperty({ required: false, description: 'Optional internal user ID of the recipient' })
  @IsOptional()
  @IsUUID()
  recipientId?: string;
}

@ApiTags('maintenance-pool')
@Controller('maintenance-pools')
export class MaintenancePoolController {
  constructor(private readonly poolService: MaintenancePoolService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  create(@Body() dto: CreatePoolDto) {
    return this.poolService.create(dto);
  }

  @Get()
  list() {
    return this.poolService.list();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.poolService.findOne(id);
  }

  @Idempotent('pool.deposit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post(':id/deposit')
  deposit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DepositDto,
  ) {
    return this.poolService.deposit(id, dto.amount, dto.funderAddress);
  }

  // High-value mutation protection (Requirement: max 1 req/sec against DoS/flooding)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('pool.assignReward')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/assign-reward')
  assignReward(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignRewardDto,
  ) {
    return this.poolService.assignReward(
      id,
      dto.issueId,
      dto.amount,
      dto.recipientAddress,
      dto.recipientId,
    );
  }
}
