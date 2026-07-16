import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { MaintenancePoolService } from './maintenance-pool.service';
import { CreatePoolDto } from './dto/create-pool.dto';
import { IsMoneyAmount } from '../common/validators/money.validator';

class DepositDto {
  @IsMoneyAmount()
  amount: string;

  @IsString()
  funderAddress: string;
}

class AssignRewardDto {
  @IsMoneyAmount()
  amount: string;

  @IsString()
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

  @Post(':id/deposit')
  deposit(@Param('id') id: string, @Body() dto: DepositDto) {
    return this.poolService.deposit(id, dto.amount, dto.funderAddress);
  }

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
