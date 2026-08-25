import { Controller, Post, Param, Body, UseGuards, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MaintenancePoolService } from './maintenance-pool.service';
import { CreateMaintenancePoolDto } from './dto/create-maintenance-pool.dto';
import { DepositDto } from './dto/deposit.dto';
import { AssignRewardDto } from './dto/assign-reward.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../common/entities/user.entity';

@ApiTags('maintenance-pool')
@ApiBearerAuth()
@Controller('maintenance-pool')
@UseGuards(JwtAuthGuard)
export class MaintenancePoolController {
  constructor(private readonly maintenancePoolService: MaintenancePoolService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new maintenance pool' })
  async create(@Body() createMaintenancePoolDto: CreateMaintenancePoolDto, @CurrentUser() user: User) {
    return this.maintenancePoolService.create(createMaintenancePoolDto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get maintenance pool by ID' })
  async findOne(@Param('id') id: string) {
    return this.maintenancePoolService.findOne(id);
  }

  @Post(':id/deposit')
  @Idempotent()
  @ApiOperation({ summary: 'Deposit into maintenance pool' })
  async deposit(@Param('id') id: string, @Body() depositDto: DepositDto, @CurrentUser() user: User) {
    return this.maintenancePoolService.deposit(id, depositDto, user);
  }

  @Post(':id/assign-reward')
  @Idempotent()
  @ApiOperation({ summary: 'Assign reward from maintenance pool' })
  async assignReward(@Param('id') id: string, @Body() assignRewardDto: AssignRewardDto, @CurrentUser() user: User) {
    return this.maintenancePoolService.assignReward(id, assignRewardDto, user);
  }
}
