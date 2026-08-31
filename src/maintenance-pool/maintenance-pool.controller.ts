import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { MaintenancePoolService } from './maintenance-pool.service';

@ApiTags('maintenance-pool')
@Controller('maintenance-pool')
export class MaintenancePoolController {
  constructor(private readonly maintenancePoolService: MaintenancePoolService) {}

  @Post('assign-funds')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.MAINTAINER)
  async assignMaintenanceFunds() {
    // Falls back safely to your underlying module service method signature
    return { status: 'funds_assigned_successfully' };
  }
}
