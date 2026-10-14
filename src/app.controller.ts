import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiExcludeEndpoint()
  getHealth() {
    return this.appService.getHealth();
  }

  // Readiness — actually pings the database so a Postgres-down instance
  // reports degraded instead of 'ok' (#577). Orchestrators gate traffic on
  // this; liveness stays the cheap always-ok GET /.
  @Get('health/ready')
  @ApiExcludeEndpoint()
  getReadiness() {
    return this.appService.getReadiness();
  }
}
