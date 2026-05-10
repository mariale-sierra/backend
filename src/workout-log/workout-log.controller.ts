import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { WorkoutLogService } from './workout-log.service';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Workout Logs')
@Controller('workout-logs')
export class WorkoutLogController {
  constructor(private readonly service: WorkoutLogService) {}

  @Post()
  @ApiOperation({ summary: 'Crear nuevo log de entrenamiento', description: 'Inicia un nuevo registro de entrenamiento' })
  @ApiResponse({ status: 201, description: 'Log de entrenamiento creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  create(@Body() body: { routineId?: number; userId: string }) {
    return this.service.createWorkout(body);
  }

  @Patch(':id/finish')
  @ApiParam({ name: 'id', description: 'ID del log de entrenamiento' })
  @ApiOperation({ summary: 'Finalizar entrenamiento', description: 'Marca un entrenamiento como finalizado' })
  @ApiResponse({ status: 200, description: 'Entrenamiento finalizado exitosamente' })
  @ApiResponse({ status: 404, description: 'Log de entrenamiento no encontrado' })
  finish(@Param('id') id: string) {
    return this.service.finishWorkout(Number(id));
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los logs de entrenamiento', description: 'Lista todos los registros de entrenamiento' })
  @ApiResponse({ status: 200, description: 'Lista de logs de entrenamiento' })
  findAll() {
    return this.service.findAll();
  }

  @Post('progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Registrar progreso de desafío', description: 'Crea un registro de progreso para un desafío específico' })
  @ApiResponse({ status: 201, description: 'Progreso registrado exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  createProgress(@Body() body, @Req() req) {
    return this.service.createWorkout({
      userId: req.user.sub,
      challengeId: body.challengeId,
    });
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'ID del log de entrenamiento' })
  @ApiOperation({ summary: 'Obtener detalles del log de entrenamiento', description: 'Devuelve los detalles de un log de entrenamiento específico' })
  @ApiResponse({ status: 200, description: 'Detalles del log de entrenamiento' })
  @ApiResponse({ status: 404, description: 'Log de entrenamiento no encontrado' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(Number(id));
  }

}

