import { Controller, Post, Param, Body, UseGuards, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BountiesService } from './bounties.service';
import { ClaimBountyDto } from './dto/claim-bounty.dto';
import { CreateBountyDto } from './dto/create-bounty.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../common/entities/user.entity';

@ApiTags('bounties')
@ApiBearerAuth()
@Controller('bounties')
@UseGuards(JwtAuthGuard)
export class BountiesController {
  constructor(private readonly bountiesService: BountiesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new bounty' })
  async create(@Body() createBountyDto: CreateBountyDto, @CurrentUser() user: User) {
    return this.bountiesService.create(createBountyDto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get bounty by ID' })
  async findOne(@Param('id') id: string) {
    return this.bountiesService.findOne(id);
  }

  @Post(':id/fund')
  @Idempotent()
  @ApiOperation({ summary: 'Fund a bounty' })
  async fund(@Param('id') id: string, @CurrentUser() user: User) {
    return this.bountiesService.fund(id, user);
  }

  @Post(':id/claim')
  @Idempotent()
  @ApiOperation({ summary: 'Claim a bounty' })
  async claim(@Param('id') id: string, @Body() claimBountyDto: ClaimBountyDto, @CurrentUser() user: User) {
    return this.bountiesService.claim(id, claimBountyDto, user);
  }

  @Post(':id/refund')
  @Idempotent()
  @ApiOperation({ summary: 'Refund a bounty' })
  async refund(@Param('id') id: string, @CurrentUser() user: User) {
    return this.bountiesService.refund(id, user);
  }
}
