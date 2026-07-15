import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UpdateExerciseRelationsDto } from './dto/update-exercise-relations.dto';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Exercises')
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear nuevo ejercicio',
    description: 'Crea un nuevo ejercicio en la base de datos',
  })
  @ApiResponse({ status: 201, description: 'Ejercicio creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  create(@Body() body: CreateExerciseDto) {
    return this.exercisesService.create(body);
  }

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Obtener todos los ejercicios',
    description: 'Lista todos los ejercicios disponibles',
  })
  @ApiResponse({ status: 200, description: 'Lista de ejercicios' })
  findAll() {
    return this.exercisesService.findAll();
  }

  @Public()
  @Get(':id/full')
  @ApiOperation({
    summary: 'Obtener ejercicio completo',
    description:
      'Devuelve un ejercicio con sus métricas asociadas usando JOINs',
  })
  @ApiParam({ name: 'id', description: 'ID del ejercicio', example: 1 })
  @ApiResponse({ status: 200, description: 'Ejercicio completo con métricas' })
  @ApiResponse({ status: 404, description: 'Ejercicio no encontrado' })
  findFullById(@Param('id', ParseIntPipe) id: number) {
    return this.exercisesService.findFullById(id);
  }

  @Post(':id/relations')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Asignar relaciones de ejercicio',
    description:
      'Asigna categorías, locations y body parts a un ejercicio existente',
  })
  @ApiParam({ name: 'id', description: 'ID del ejercicio', example: 1 })
  @ApiResponse({
    status: 201,
    description: 'Relaciones asignadas exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Ejercicio no encontrado' })
  updateRelations(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateExerciseRelationsDto,
  ) {
    return this.exercisesService.updateRelations(id, dto);
  }
}
