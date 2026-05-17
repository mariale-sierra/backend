import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, Query } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { ChallengeProgressDto } from './dto/challenge-progress.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiOkResponse } from '@nestjs/swagger';
import { WorkoutLogService } from '../workout-log/workout-log.service';
import { CreateWorkoutProgressDto } from '../workout-log/dto/create-workout-progress.dto';
import { UnauthorizedException } from '@nestjs/common';

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
  @ApiOperation({ summary: 'Crear nuevo desafío', description: 'Crea un nuevo desafío para que otros usuarios se unan' })
  @ApiResponse({ status: 201, description: 'Desafío creado exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  create(@Body() dto: CreateChallengeDto, @Req() req) {
    return this.challengesService.create(dto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/join')
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({ summary: 'Unirse a un desafío', description: 'El usuario actual se une a un desafío existente' })
  @ApiResponse({ status: 200, description: 'Se unió al desafío exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Desafío no encontrado' })
  join(@Param('id') challengeId: string, @Req() req) {
    return this.challengesService.joinChallenge(req.user.sub, challengeId);
  }
  
  @Get()
  @ApiOperation({ summary: 'Obtener todos los desafíos', description: 'Lista todos los desafíos disponibles' })
  @ApiResponse({ status: 200, description: 'Lista de desafíos' })
  findAll() {
    return this.challengesService.findAll();
  }

  @Get('progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener progreso del desafío actual', description: 'Devuelve el progreso del usuario en el desafío activo, incluyendo día actual, si completó hoy y horas restantes' })
  @ApiOkResponse({
    description: 'Progreso del desafío obtenido exitosamente',
    type: ChallengeProgressDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'No hay desafío activo para el usuario' })
  getProgress(@Req() req): Promise<ChallengeProgressDto | null> {
    return this.challengesService.getProgress(req.user.sub, req.query.challengeId);
  }

  @Post('progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Registrar progreso del desafío', description: 'Crea un workout asociado al usuario autenticado y al challenge indicado' })
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
  @ApiOperation({ summary: 'Obtener usuarios de un desafío', description: 'Lista todos los usuarios que están participando en un desafío' })
  @ApiResponse({ status: 200, description: 'Lista de usuarios en el desafío' })
  @ApiResponse({ status: 404, description: 'Desafío no encontrado' })
  findUsers(@Param('id') id: string) {
    return this.challengesService.findUsersByChallenge(id);
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({ summary: 'Obtener detalles de un desafío', description: 'Devuelve la información completa de un desafío específico' })
  @ApiResponse({ status: 200, description: 'Detalles del desafío' })
  @ApiResponse({ status: 404, description: 'Desafío no encontrado' })
  findOne(@Param('id') id: string) {
    return this.challengesService.findOne(id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({ summary: 'Actualizar desafío', description: 'Actualiza la información de un desafío existente' })
  @ApiResponse({ status: 200, description: 'Desafío actualizado exitosamente' })
  @ApiResponse({ status: 404, description: 'Desafío no encontrado' })
  update(@Param('id') id: string, @Body() updateChallengeDto: UpdateChallengeDto) {
    return this.challengesService.update(id, updateChallengeDto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({ summary: 'Eliminar desafío', description: 'Elimina un desafío existente' })
  @ApiResponse({ status: 200, description: 'Desafío eliminado exitosamente' })
  @ApiResponse({ status: 404, description: 'Desafío no encontrado' })
  remove(@Param('id') id: string) {
    return this.challengesService.remove(id);
  }

  @Get(':id/today')
  @ApiParam({ name: 'id', description: 'ID del desafío' })
  @ApiOperation({ summary: 'Obtener el progreso del desafío de hoy', description: 'Devuelve el progreso del desafío de hoy para el usuario' })
  @ApiResponse({ status: 200, description: 'Progreso del desafío de hoy' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Desafío no encontrado' })
  getToday(@Param('id') challengeId: string, @Req() req: any) {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedException('User not authenticated');
    }

    const userId = req.user.id; // Asumiendo que el userId viene del token o sesión
    return this.challengesService.getToday(challengeId, userId);
  }
}
