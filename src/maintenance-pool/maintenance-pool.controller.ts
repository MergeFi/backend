import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiQuery } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { MaintenancePoolService } from './maintenance-pool.service';
import { CreatePoolDto } from './dto/create-pool.dto';
import { IsMoneyAmount } from '../common/validators/money.validator';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { MaintenancePool } from '../common/entities';

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
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query() paginationQuery?: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<MaintenancePool>> {
    const page = paginationQuery?.page || 1;
    const limit = paginationQuery?.limit || 50;
    const { data, total } = await this.poolService.list(page, limit);
    return new PaginatedResponseDto(data, page, limit, total);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.poolService.findOne(id);
  }

  @Idempotent('pool.deposit')
  @Post(':id/deposit')
  deposit(@Param('id') id: string, @Body() dto: DepositDto) {
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
