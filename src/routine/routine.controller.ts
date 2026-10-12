import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { RoutineService } from './routine.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateRoutineDto } from './dto/create-routine.dto';
import { AddRoutineExerciseDto } from './dto/add-routine-exercise.dto';
import { parseSubstitutionsParam } from '../exercises/exercise-substitution.service';
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
    description: 'Lista las rutinas activas del usuario autenticado',
  })
  @ApiResponse({ status: 200, description: 'Lista de rutinas' })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.routineService.findAll(user.sub);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID de la rutina' })
  @ApiOperation({
    summary: 'Obtener detalles de una rutina',
    description:
      'Devuelve la información completa de una rutina propia y activa',
  })
  @ApiResponse({ status: 200, description: 'Detalles de la rutina' })
  @ApiResponse({ status: 404, description: 'Rutina no encontrada' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.routineService.findOne(Number(id), user.sub);
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
  @ApiOperation({
    summary: 'Rutina de hoy de un challenge',
    description:
      'Incluye `locations` (en cuáles se puede hacer; requiresSubstitution marca las que exigen cambiar ejercicios). Con ?location=<code>&substitutions=<origId>:<subId>,... devuelve la vista efectiva del usuario (ejercicios sustituidos, solo en memoria; la rutina compartida no se modifica). Sustituciones inválidas responden 400.',
  })
  @ApiQuery({ name: 'location', required: false })
  @ApiQuery({ name: 'substitutions', required: false })
  getTodayRoutine(
    @Param('challengeId') challengeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req,
    @Query('location') location?: string,
    @Query('substitutions') substitutions?: string,
  ) {
    return this.routineService.getTodayRoutine(
      challengeId,
      user.sub,
      resolveRequestTimezone(req),
      {
        locationCode: location,
        substitutions: parseSubstitutionsParam(substitutions),
      },
    );
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID de la rutina' })
  @ApiOperation({
    summary: 'Desactivar una rutina',
    description:
      'Desactiva una rutina del usuario autenticado. Soft delete: preserva el historial de workout logs.',
  })
  @ApiResponse({ status: 200, description: 'Rutina desactivada exitosamente' })
  @ApiResponse({ status: 403, description: 'No eres el dueño de esta rutina' })
  @ApiResponse({ status: 404, description: 'Rutina no encontrada' })
  deactivateRoutine(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.routineService.deactivateRoutine(id, user.sub);
  }
}
