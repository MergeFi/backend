import { Controller, Get, Param, Post, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { MilestonesService } from './milestones.service';
import { Milestone } from '../common/entities/milestone.entity';

@ApiTags('milestones')
@Controller('milestones')
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new milestone' })
  @ApiResponse({ status: 201, description: 'Milestone created' })
  async create(@Body() data: Partial<Milestone>) {
    return this.milestonesService.create(data);
  }

  @Get()
  @ApiOperation({ summary: 'List milestones with pagination' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of items per page (max 100)', example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Number of items to skip', example: 0 })
  @ApiResponse({ status: 200, description: 'Paginated list of milestones' })
  async list(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.milestonesService.list({ limit, offset });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a milestone by ID' })
  @ApiResponse({ status: 200, description: 'Milestone found' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.milestonesService.findOne(id);
  }

  @Post(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a milestone' })
  @ApiResponse({ status: 200, description: 'Milestone updated' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() data: Partial<Milestone>) {
    return this.milestonesService.update(id, data);
  }

  @Post(':id/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a milestone' })
  @ApiResponse({ status: 200, description: 'Milestone deleted' })
  @ApiResponse({ status: 404, description: 'Milestone not found' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.milestonesService.delete(id);
    return { success: true };
  }
}