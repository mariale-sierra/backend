import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly service: MetricsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post('workout-log-exercises/:id')
  addMetric(
    @Param('id') id: string,
    @Body() body: { metricCode: string; value: number },
  ) {
    return this.service.addMetric(Number(id), body.metricCode, body.value);
  }
}