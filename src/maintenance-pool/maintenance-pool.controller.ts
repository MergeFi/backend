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
