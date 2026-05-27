import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { ChallengeProgressDto } from './dto/challenge-progress.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiOkResponse,
} from '@nestjs/swagger';
import { WorkoutLogService } from '../workout-log/workout-log.service';
import { CreateWorkoutProgressDto } from '../workout-log/dto/create-workout-progress.dto';
import { UseGuards } from '@nestjs/common';
import { ChallengeProgressSummaryDto } from './dto/challenge-progress-summary.dto';
import { UpdateChallengeCycleDayDto } from './dto/update-challenge-cycle-day.dto';

@ApiTags('Challenges')
@Controller('challenges')
export class ChallengesController {
  constructor(
    private readonly challengesService: ChallengesService,
    private readonly workoutLogService: WorkoutLogService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear nuevo desafío',
    description: 'Crea un nuevo desafío para que otros usuarios se unan',
  })
  @ApiResponse({ status: 201, description: 'Desafío creado exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  create(@Body() dto: CreateChallengeDto, @Req() req) {
    return this.challengesService.create(dto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/join')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({
    summary: 'Unirse a un desafío',
    description: 'El usuario actual se une a un desafío existente',
  })
  @ApiResponse({ status: 200, description: 'Se unió al desafío exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Desafío no encontrado' })
  join(@Param('id', ParseUUIDPipe) challengeId: string, @Req() req) {
    return this.challengesService.joinChallenge(req.user.sub, challengeId);
  }
  @UseGuards(JwtAuthGuard)
  @Patch(':id/leave')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({
    summary: 'Salir de un desafío',
    description:
      'Actualiza el status del usuario autenticado en challenge_user_map a left',
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario salió del desafío exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'El usuario no puede salir de este desafío',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Desafío o relación no encontrada' })
  leaveChallenge(@Param('id', ParseUUIDPipe) challengeId: string, @Req() req) {
    return this.challengesService.leaveChallenge(req.user.sub, challengeId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/complete')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({
    summary: 'Completar un desafío',
    description:
      'Actualiza el status del usuario autenticado en challenge_user_map a completed',
  })
  @ApiResponse({ status: 200, description: 'Desafío completado exitosamente' })
  @ApiResponse({
    status: 400,
    description: 'El usuario no puede completar este desafío',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Desafío o relación no encontrada' })
  completeChallenge(@Param('id', ParseUUIDPipe) challengeId: string, @Req() req) {
    return this.challengesService.completeChallenge(req.user.sub, challengeId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/cycle-days/:dayInCycle')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiParam({
    name: 'dayInCycle',
    description: 'Día dentro del ciclo',
    example: 1,
  })
  @ApiOperation({
    summary: 'Actualizar día del ciclo',
    description:
      'Permite cambiar manualmente el tipo de día o la rutina asignada en challenge_cycle_days',
  })
  @ApiResponse({
    status: 200,
    description: 'Día del ciclo actualizado exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({
    status: 404,
    description: 'Challenge o día del ciclo no encontrado',
  })
  updateCycleDay(
    @Param('id', ParseUUIDPipe) challengeId: string,
    @Param('dayInCycle', ParseIntPipe) dayInCycle: number,
    @Body() dto: UpdateChallengeCycleDayDto,
  ) {
    return this.challengesService.updateCycleDay(challengeId, dayInCycle, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Obtener todos los desafíos',
    description: 'Lista todos los desafíos disponibles',
  })
  @ApiResponse({ status: 200, description: 'Lista de desafíos' })
  findAll() {
    return this.challengesService.findAll();
  }

  @Get('progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener progreso del desafío actual',
    description:
      'Devuelve el progreso del usuario en el desafío activo, incluyendo día actual, si completó hoy y horas restantes',
  })
  @ApiOkResponse({
    description: 'Progreso del desafío obtenido exitosamente',
    type: ChallengeProgressDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({
    status: 404,
    description: 'No hay desafío activo para el usuario',
  })
  getProgress(@Req() req): Promise<ChallengeProgressDto | null> {
    return this.challengesService.getProgress(
      req.user.sub,
      req.query.challengeId,
    );
  }

  @Post('progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Registrar progreso del desafío',
    description:
      'Crea un workout asociado al usuario autenticado y al challenge indicado',
  })
  @ApiOkResponse({ description: 'Progreso registrado exitosamente' })
  @ApiResponse({ status: 201, description: 'Progreso registrado exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  createProgress(@Body() body: CreateWorkoutProgressDto, @Req() req) {
    return this.workoutLogService.createWorkout({
      ...body,
      userId: req.user.sub,
      challengeId: body.challengeId,
    });
  }

  @Get(':id/users')
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({
    summary: 'Obtener usuarios de un desafío',
    description:
      'Lista todos los usuarios que están participando en un desafío',
  })
  @ApiResponse({ status: 200, description: 'Lista de usuarios en el desafío' })
  @ApiResponse({ status: 404, description: 'Desafío no encontrado' })
  findUsers(@Param('id', ParseUUIDPipe) id: string) {
    return this.challengesService.findUsersByChallenge(id);
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({
    summary: 'Obtener detalles de un desafío',
    description: 'Devuelve la información completa de un desafío específico',
  })
  @ApiResponse({ status: 200, description: 'Detalles del desafío' })
  @ApiResponse({ status: 404, description: 'Desafío no encontrado' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.challengesService.findOne(id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({
    summary: 'Actualizar desafío',
    description: 'Actualiza la información de un desafío existente',
  })
  @ApiResponse({ status: 200, description: 'Desafío actualizado exitosamente' })
  @ApiResponse({ status: 404, description: 'Desafío no encontrado' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateChallengeDto: UpdateChallengeDto,
  ) {
    return this.challengesService.update(id, updateChallengeDto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({
    summary: 'Eliminar desafío',
    description: 'Elimina un desafío existente',
  })
  @ApiResponse({ status: 200, description: 'Desafío eliminado exitosamente' })
  @ApiResponse({ status: 404, description: 'Desafío no encontrado' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.challengesService.remove(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/today')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({
    summary: 'Obtener información del challenge para hoy',
    description:
      'Devuelve el día actual del challenge, tipo de día y rutina correspondiente',
  })
  @ApiResponse({
    status: 200,
    description: 'Información del día obtenida exitosamente',
  })
  @ApiResponse({
    status: 401,
    description: 'No autorizado',
  })
  @ApiResponse({
    status: 404,
    description: 'Challenge no encontrado',
  })
  getToday(@Param('id', ParseUUIDPipe) challengeId: string, @Req() req) {
    return this.challengesService.getToday(challengeId, req.user.sub);
  }

  @Get(':id/progress-summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener resumen del progreso del challenge',
  })
  @ApiOkResponse({
    type: ChallengeProgressSummaryDto,
  })
  getProgressSummary(@Param('id', ParseUUIDPipe) challengeId: string, @Req() req) {
    return this.challengesService.getProgressSummary(challengeId, req.user.sub);
  }
}
