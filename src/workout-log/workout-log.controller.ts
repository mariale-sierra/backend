import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { WorkoutLogService } from './workout-log.service';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { CreateWorkoutProgressDto } from './dto/create-workout-progress.dto';
import { CreateWorkoutLogDto } from './dto/create-workout-log.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Workout Logs')
@Controller('workout-logs')
export class WorkoutLogController {
  constructor(private readonly service: WorkoutLogService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear nuevo log de entrenamiento', description: 'Inicia un nuevo registro de entrenamiento. El usuario dueño siempre se toma del JWT.' })
  @ApiResponse({ status: 201, description: 'Log de entrenamiento creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  create(@Body() body: CreateWorkoutLogDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createWorkout({ routineId: body.routineId, userId: user.sub });
  }

  @Patch(':id/finish')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID del log de entrenamiento' })
  @ApiOperation({ summary: 'Finalizar entrenamiento', description: 'Marca un entrenamiento como finalizado' })
  @ApiResponse({ status: 200, description: 'Entrenamiento finalizado exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No eres el dueño de este log' })
  @ApiResponse({ status: 404, description: 'Log de entrenamiento no encontrado' })
  finish(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.finishWorkout(Number(id), user.sub);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener mis logs de entrenamiento', description: 'Lista los registros de entrenamiento del usuario autenticado (nunca los de otros usuarios)' })
  @ApiResponse({ status: 200, description: 'Lista de logs de entrenamiento' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user.sub);
  }

  @Post('progress')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Registrar progreso de desafío', description: 'Crea un registro de progreso para un desafío específico' })
  @ApiResponse({ status: 201, description: 'Progreso registrado exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  createProgress(@Body() body: CreateWorkoutProgressDto, @Req() req) {
    return this.service.createWorkout({
      userId: req.user.sub,
      challengeId: body.challengeId,
      routineId: body.routineId,
      imageUrl: body.imageUrl,
      caption: body.caption,
      visibility: body.visibility,
      isRestDay: body.isRestDay,
    });
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID del log de entrenamiento' })
  @ApiOperation({ summary: 'Obtener detalles del log de entrenamiento', description: 'Devuelve los detalles de un log de entrenamiento específico. Solo accesible por su dueño.' })
  @ApiResponse({ status: 200, description: 'Detalles del log de entrenamiento' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No eres el dueño de este log' })
  @ApiResponse({ status: 404, description: 'Log de entrenamiento no encontrado' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(Number(id), user.sub);
  }

}

