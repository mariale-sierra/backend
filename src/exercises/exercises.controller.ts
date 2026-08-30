import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UpdateExerciseRelationsDto } from './dto/update-exercise-relations.dto';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { CountExercisesQueryDto } from './dto/count-exercises-query.dto';
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
  @Get('body-parts')
  @ApiOperation({
    summary: 'Obtener catálogo de partes del cuerpo',
    description:
      'Lista todas las partes del cuerpo activas (jerarquía de músculos)',
  })
  @ApiResponse({ status: 200, description: 'Lista de partes del cuerpo' })
  findAllBodyParts() {
    return this.exercisesService.findAllBodyParts();
  }

  @Public()
  @Get('count')
  @ApiOperation({
    summary: 'Contar ejercicios que coinciden con filtros',
    description:
      'Cuenta los ejercicios activos que coinciden con las categorías y/o ubicaciones dadas (por nombre, ver GET /exercises/categories). Sin filtros, cuenta todos los ejercicios activos.',
  })
  @ApiResponse({ status: 200, description: 'Conteo de ejercicios' })
  async countMatching(@Query() query: CountExercisesQueryDto) {
    const count = await this.exercisesService.countMatchingExercises(
      query.categories ?? [],
      query.locations ?? [],
    );
    return { count };
  }

  @Public()
  @Get('categories')
  @ApiOperation({
    summary: 'Obtener catálogo de categorías',
    description: 'Lista todas las categorías de ejercicio (tipo de actividad)',
  })
  @ApiResponse({ status: 200, description: 'Lista de categorías' })
  findAllCategories() {
    return this.exercisesService.findAllCategories();
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
