import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { RoutineService } from './routine.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { AddRoutineExerciseDto } from './dto/add-routine-exercise.dto';
import { resolveRequestTimezone } from '../common/timezone.util';

@ApiTags('Routine')
@Controller('routine')
export class RoutineController {
  constructor(private readonly routineService: RoutineService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear nueva rutina',
    description:
      'Crea una nueva rutina de entrenamiento. El dueño siempre se toma del JWT.',
  })
  @ApiResponse({ status: 201, description: 'Rutina creada exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  create(
    @Body() body: CreateRoutineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routineService.create(body, user.sub);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener todas las rutinas',
    description: 'Lista todas las rutinas disponibles',
  })
  @ApiResponse({ status: 200, description: 'Lista de rutinas' })
  findAll() {
    return this.routineService.findAll();
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID de la rutina' })
  @ApiOperation({
    summary: 'Obtener detalles de una rutina',
    description: 'Devuelve la información completa de una rutina específica',
  })
  @ApiResponse({ status: 200, description: 'Detalles de la rutina' })
  @ApiResponse({ status: 404, description: 'Rutina no encontrada' })
  findOne(@Param('id') id: string) {
    return this.routineService.findOne(Number(id));
  }

  @Post(':id/exercises')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID de la rutina' })
  @ApiOperation({
    summary: 'Añadir ejercicio a rutina',
    description:
      'Agrega un ejercicio a una rutina existente, junto con sus sets (reps, descanso) y targets por set/por ejercicio (metric_type_id + valor). Si la rutina tiene dueño registrado, solo el dueño puede modificarla.',
  })
  @ApiResponse({ status: 200, description: 'Ejercicio añadido exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No eres el dueño de esta rutina' })
  @ApiResponse({ status: 404, description: 'Rutina o ejercicio no encontrado' })
  addExercise(
    @Param('id') routineId: string,
    @Body() body: AddRoutineExerciseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routineService.addExerciseToRoutine(
      Number(routineId),
      body,
      user.sub,
    );
  }

  @Get('today/:challengeId')
  @ApiBearerAuth()
  getTodayRoutine(
    @Param('challengeId') challengeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req,
  ) {
    return this.routineService.getTodayRoutine(
      challengeId,
      user.sub,
      resolveRequestTimezone(req),
    );
  }
}
