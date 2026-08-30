import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AddMetricDto } from './dto/add-metric.dto';

@ApiTags('Metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly service: MetricsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Obtener todas las métricas',
    description: 'Lista todos los tipos de métricas disponibles',
  })
  @ApiResponse({ status: 200, description: 'Lista de métricas' })
  findAll() {
    return this.service.findAll();
  }

  @Post('workout-log-exercises/:id')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    description: 'ID del ejercicio del log de entrenamiento',
  })
  @ApiOperation({
    summary: 'Agregar métrica a ejercicio',
    description:
      'Añade una métrica (ej: peso, repeticiones) a un ejercicio registrado. Solo si el log de entrenamiento pertenece al usuario autenticado.',
  })
  @ApiResponse({ status: 201, description: 'Métrica agregada exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({
    status: 403,
    description: 'El log de entrenamiento no te pertenece',
  })
  @ApiResponse({ status: 404, description: 'Ejercicio no encontrado' })
  addMetric(
    @Param('id') id: string,
    @Body() body: AddMetricDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addMetric(
      Number(id),
      body.metricCode,
      body.value,
      user.sub,
    );
  }

  @Post('workout-log-exercise-sets/:id')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    description:
      'ID del set (workout_log_exercise_set) del log de entrenamiento',
  })
  @ApiOperation({
    summary: 'Agregar métrica a un set específico',
    description:
      'Registra el valor real de una métrica para un set puntual de un ejercicio registrado (a diferencia de POST /metrics/workout-log-exercises/:id, que no distingue entre sets). Si el set ya tiene un target para esa métrica (copiado de la rutina al crear el workout), lo sobrescribe con el valor real en vez de rechazarlo como duplicado.',
  })
  @ApiResponse({
    status: 201,
    description: 'Métrica del set agregada exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({
    status: 403,
    description: 'El log de entrenamiento no te pertenece',
  })
  @ApiResponse({ status: 404, description: 'Set no encontrado' })
  addSetMetric(
    @Param('id') id: string,
    @Body() body: AddMetricDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addSetMetric(
      Number(id),
      body.metricCode,
      body.value,
      user.sub,
    );
  }
}
