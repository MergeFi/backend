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
  @IsMoneyAmount()
  amount: string;

  @IsStellarAddress()
  funderAddress: string;
}

class AssignRewardDto {
  @IsUUID()
  issueId: string;

  @IsMoneyAmount()
  amount: string;

  @IsStellarAddress()
  recipientAddress: string;

  @IsOptional()
  @IsUUID()
  recipientId?: string;
}

@ApiTags('maintenance-pool')
@Controller('maintenance-pools')
export class MaintenancePoolController {
  constructor(private readonly poolService: MaintenancePoolService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @ApiOperation({
    summary: 'Create a maintenance pool',
    description:
      'Creates a continuous funding pool for open-source repository maintenance. Requires sponsor or maintainer role.',
  })
  create(@Body() dto: CreatePoolDto) {
    return this.poolService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List maintenance pools',
    description:
      'Retrieves all active maintenance funding pools and current balances.',
  })
  list() {
    return this.poolService.list();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get maintenance pool details',
    description:
      'Retrieves metadata, funding history, and remaining balance for a specific maintenance pool.',
  })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.poolService.findOne(id);
  }

  @Idempotent('pool.deposit')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  @Post(':id/deposit')
  @ApiOperation({
    summary: 'Deposit into maintenance pool',
    description:
      'Funds an existing maintenance pool using a Stellar account. Requires sponsor or maintainer role.',
  })
  deposit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DepositDto,
  ) {
    return this.poolService.deposit(id, dto.amount, dto.funderAddress);
  }

  // High-value mutation protection (Requirement: max 1 req/sec against DoS/flooding)
  @Throttle({ short: { limit: 1, ttl: 1000 } })
  @Idempotent('pool.assignReward')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  @Post(':id/assign-reward')
  @ApiOperation({
    summary: 'Assign reward from maintenance pool',
    description:
      'Disburses reward funds from the pool to a designated recipient for issue resolution. Restricted to maintainers.',
  })
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
