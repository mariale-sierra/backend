import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { HealthService } from './health.service';
import type { LivenessReport, ReadinessReport } from './health.service';

/**
 * B6: probes for the Docker HEALTHCHECK, the deploy workflow and external
 * uptime monitoring (B12). Public (a probe has no token) and exempt from the
 * rate limit (a monitor polling every few seconds must not eat a client's
 * quota or get 429s). `Cache-Control: no-store` already comes from
 * securityHeadersMiddleware for every route.
 */
@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness: el proceso responde (no consulta la base de datos)',
  })
  @ApiResponse({ status: 200, description: 'La API está viva' })
  liveness(): LivenessReport {
    return this.healthService.liveness();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness: PostgreSQL responde a SELECT 1; Redis es informativo',
  })
  @ApiResponse({ status: 200, description: 'Lista para atender tráfico' })
  @ApiResponse({ status: 503, description: 'PostgreSQL no responde' })
  async readiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessReport> {
    const report = await this.healthService.readiness();
    if (report.status !== 'ok') res.status(503);
    return report;
  }
}
