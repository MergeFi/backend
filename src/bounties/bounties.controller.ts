import { Controller, Get, Param, Post, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { BountiesService } from './bounties.service';
import { CreateBountyDto } from './dto/create-bounty.dto';
import { ClaimBountyDto } from './dto/claim-bounty.dto';
import { BountyStatus } from '../common/entities/bounty.entity';

@ApiTags('bounties')
@Controller('bounties')
export class BountiesController {
  constructor(private readonly bountiesService: BountiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new bounty' })
  @ApiResponse({ status: 201, description: 'Bounty created' })
  async create(@Body() dto: CreateBountyDto) {
    // TODO: Get sponsorId from authenticated user
    const sponsorId = '00000000-0000-0000-0000-000000000000';
    return this.bountiesService.create(dto, sponsorId);
  }

  @Get()
  @ApiOperation({ summary: 'List bounties with pagination' })
  @ApiQuery({ name: 'status', required: false, enum: BountyStatus, description: 'Filter by bounty status' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of items per page (max 100)', example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Number of items to skip', example: 0 })
  @ApiResponse({ status: 200, description: 'Paginated list of bounties' })
  async list(
    @Query('status') status?: BountyStatus,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.bountiesService.list(status, { limit, offset });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a bounty by ID' })
  @ApiResponse({ status: 200, description: 'Bounty found' })
  @ApiResponse({ status: 404, description: 'Bounty not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bountiesService.findOne(id);
  }

  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim a bounty' })
  @ApiResponse({ status: 200, description: 'Bounty claimed' })
  @ApiResponse({ status: 404, description: 'Bounty not found' })
  @ApiResponse({ status: 409, description: 'Bounty cannot be claimed in current state' })
  async claim(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ClaimBountyDto) {
    // TODO: Get claimantId from authenticated user
    const claimantId = '00000000-0000-0000-0000-000000000000';
    return this.bountiesService.claim(id, dto, claimantId);
  }

  @Post(':id/submit-work')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit work for a bounty (PR URL)' })
  @ApiResponse({ status: 200, description: 'Work submitted' })
  @ApiResponse({ status: 404, description: 'Bounty not found' })
  @ApiResponse({ status: 409, description: 'Bounty cannot accept work submission in current state' })
  async submitWork(@Param('id', ParseUUIDPipe) id: string, @Body('prUrl') prUrl: string) {
    // TODO: Get claimantId from authenticated user
    const claimantId = '00000000-0000-0000-0000-000000000000';
    return this.bountiesService.submitWork(id, claimantId, prUrl);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve submitted work' })
  @ApiResponse({ status: 200, description: 'Work approved' })
  @ApiResponse({ status: 404, description: 'Bounty not found' })
  @ApiResponse({ status: 409, description: 'Bounty cannot be approved in current state' })
  async approve(@Param('id', ParseUUIDPipe) id: string) {
    // TODO: Get sponsorId from authenticated user
    const sponsorId = '00000000-0000-0000-0000-000000000000';
    return this.bountiesService.approveWork(id, sponsorId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject submitted work' })
  @ApiResponse({ status: 200, description: 'Work rejected' })
  @ApiResponse({ status: 404, description: 'Bounty not found' })
  @ApiResponse({ status: 409, description: 'Bounty cannot be rejected in current state' })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body('reason') reason: string) {
    // TODO: Get sponsorId from authenticated user
    const sponsorId = '00000000-0000-0000-0000-000000000000';
    return this.bountiesService.rejectWork(id, sponsorId, reason);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a bounty' })
  @ApiResponse({ status: 200, description: 'Bounty cancelled' })
  @ApiResponse({ status: 404, description: 'Bounty not found' })
  @ApiResponse({ status: 409, description: 'Bounty cannot be cancelled in current state' })
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    // TODO: Get sponsorId from authenticated user
    const sponsorId = '00000000-0000-0000-0000-000000000000';
    return this.bountiesService.cancel(id, sponsorId);
  }
}