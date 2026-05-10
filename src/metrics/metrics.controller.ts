import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

@ApiTags('Metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly service: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Obtener todas las métricas', description: 'Lista todos los tipos de métricas disponibles' })
  @ApiResponse({ status: 200, description: 'Lista de métricas' })
  findAll() {
    return this.service.findAll();
  }

  @Post('workout-log-exercises/:id')
  @ApiParam({ name: 'id', description: 'ID del ejercicio del log de entrenamiento' })
  @ApiOperation({ summary: 'Agregar métrica a ejercicio', description: 'Añade una métrica (ej: peso, repeticiones) a un ejercicio registrado' })
  @ApiResponse({ status: 201, description: 'Métrica agregada exitosamente' })
  @ApiResponse({ status: 404, description: 'Ejercicio no encontrado' })
  addMetric(
    @Param('id') id: string,
    @Body() body: { metricCode: string; value: number },
  ) {
    return this.service.addMetric(Number(id), body.metricCode, body.value);
  }
}