import { Controller, Get, Param, Post, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { MaintenancePoolService } from './maintenance-pool.service';
import { MaintenancePool } from '../common/entities/maintenance-pool.entity';

@ApiTags('maintenance-pools')
@Controller('maintenance-pools')
export class MaintenancePoolController {
  constructor(private readonly maintenancePoolService: MaintenancePoolService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new maintenance pool' })
  @ApiResponse({ status: 201, description: 'Maintenance pool created' })
  async create(@Body() data: Partial<MaintenancePool>) {
    return this.maintenancePoolService.create(data);
  }

  @Get()
  @ApiOperation({ summary: 'List maintenance pools with pagination' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of items per page (max 100)', example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Number of items to skip', example: 0 })
  @ApiResponse({ status: 200, description: 'Paginated list of maintenance pools' })
  async list(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.maintenancePoolService.list({ limit, offset });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a maintenance pool by ID' })
  @ApiResponse({ status: 200, description: 'Maintenance pool found' })
  @ApiResponse({ status: 404, description: 'Maintenance pool not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.maintenancePoolService.findOne(id);
  }

  @Post(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a maintenance pool' })
  @ApiResponse({ status: 200, description: 'Maintenance pool updated' })
  @ApiResponse({ status: 404, description: 'Maintenance pool not found' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() data: Partial<MaintenancePool>) {
    return this.maintenancePoolService.update(id, data);
  }

  @Post(':id/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a maintenance pool' })
  @ApiResponse({ status: 200, description: 'Maintenance pool deleted' })
  @ApiResponse({ status: 404, description: 'Maintenance pool not found' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.maintenancePoolService.delete(id);
    return { success: true };
  }
}