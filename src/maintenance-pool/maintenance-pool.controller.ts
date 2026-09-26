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
import {
  ApiInternalErrorResponse,
  ApiStandardErrorResponses,
} from '../common/swagger/api-common-responses.decorator';

class DepositDto {
  @ApiProperty()
  @IsMoneyAmount()
  amount: string;

  @ApiProperty()
  @IsStellarAddress()
  funderAddress: string;
}

class AssignRewardDto {
  @ApiProperty()
  @IsUUID()
  issueId: string;

  @ApiProperty()
  @IsMoneyAmount()
  amount: string;

  @ApiProperty()
  @IsStellarAddress()
  recipientAddress: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  recipientId?: string;
}

@ApiTags('maintenance-pool')
@Controller('maintenance-pools')
@ApiInternalErrorResponse()
export class MaintenancePoolController {
  constructor(private readonly poolService: MaintenancePoolService) {}

  @ApiOperation({ summary: 'Create a maintenance pool' })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SPONSOR, UserRole.MAINTAINER)
  create(@Body() dto: CreatePoolDto) {
    return this.poolService.create(dto);
  }

  @ApiOperation({ summary: 'List maintenance pools' })
  @Get()
  list() {
    return this.poolService.list();
  }

  @ApiOperation({ summary: 'Get a maintenance pool by id' })
  @ApiStandardErrorResponses()
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.poolService.findOne(id);
  }

  @ApiOperation({ summary: 'Deposit funds into a maintenance pool' })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
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

  @ApiOperation({
    summary: 'Assign a maintenance pool reward for a resolved issue',
    description: 'Rate-limited to 1 request/second against DoS/flooding.',
  })
  @ApiBearerAuth()
  @ApiStandardErrorResponses()
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
