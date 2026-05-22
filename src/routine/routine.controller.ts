import { Controller, Get, Post, Body, Param, UseGuards, Req} from '@nestjs/common';
import { RoutineService } from './routine.service';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';


@ApiTags('Routine')
@Controller('routine')
export class RoutineController {
  constructor(private readonly routineService: RoutineService) {}

  @Post()
  @ApiOperation({ summary: 'Crear nueva rutina', description: 'Crea una nueva rutina de entrenamiento' })
  @ApiResponse({ status: 201, description: 'Rutina creada exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  create(@Body() body) {
    return this.routineService.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todas las rutinas', description: 'Lista todas las rutinas disponibles' })
  @ApiResponse({ status: 200, description: 'Lista de rutinas' })
  findAll() {
    return this.routineService.findAll();
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'ID de la rutina' })
  @ApiOperation({ summary: 'Obtener detalles de una rutina', description: 'Devuelve la información completa de una rutina específica' })
  @ApiResponse({ status: 200, description: 'Detalles de la rutina' })
  @ApiResponse({ status: 404, description: 'Rutina no encontrada' })
  findOne(@Param('id') id: string) {
    return this.routineService.findOne(Number(id));
  }
  
  @Post(':id/exercises')
  @ApiParam({ name: 'id', description: 'ID de la rutina' })
  @ApiOperation({ summary: 'Añadir ejercicio a rutina', description: 'Agrega un ejercicio a una rutina existente' })
  @ApiResponse({ status: 200, description: 'Ejercicio añadido exitosamente' })
  @ApiResponse({ status: 404, description: 'Rutina no encontrada' })
  addExercise(
    @Param('id') routineId: string,
    @Body() body: { exerciseId: number },
  ) {
    return this.routineService.addExerciseToRoutine(
      Number(routineId),
      body.exerciseId,
    );
  }

  @Get('today/:challengeId')
  @UseGuards(JwtAuthGuard)
  getTodayRoutine(
    @Param('challengeId') challengeId: string,
    @Req() req,
  ) {
    return this.routineService.getTodayRoutine(
      challengeId,
      req.user.sub,
    );
  }
}