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
import { QueryExercisesDto } from './dto/query-exercises.dto';
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
    summary: 'Obtener catálogo de ejercicios (paginado, filtrable, buscable)',
    description:
      'Lista ejercicios activos, paginada. Filtros por category/location/region/muscle (códigos), búsqueda multilenguaje por nombre (?search=, busca en todos los locales guardados sin importar el idioma activo), y ?locale= para el nombre traducido. Respuesta liviana: siempre incluye una imagen, nunca la lista completa de músculos ni instrucciones.',
  })
  @ApiResponse({ status: 200, description: 'Página de ejercicios' })
  findAll(@Query() query: QueryExercisesDto) {
    return this.exercisesService.findAll(query);
  }

  @Public()
  @Get('muscle-regions')
  @ApiOperation({
    summary: 'Obtener regiones musculares',
    description:
      'Lista las 9 regiones musculares curadas, con conteo de músculos hijos',
  })
  @ApiResponse({ status: 200, description: 'Lista de regiones musculares' })
  findMuscleRegions() {
    return this.exercisesService.findMuscleRegions();
  }

  @Public()
  @Get('muscle-regions/:code/muscles')
  @ApiOperation({
    summary: 'Obtener músculos de una región',
    description:
      'Lista los músculos de una región, cada uno con su ícono (o null) y sus muscle_svg_parts agrupados por vista, para armar el highlight a nivel región en un solo call',
  })
  @ApiParam({
    name: 'code',
    description: 'Código de la región',
    example: 'shoulders',
  })
  @ApiResponse({ status: 200, description: 'Lista de músculos de la región' })
  findMusclesInRegion(@Param('code') code: string) {
    return this.exercisesService.findMusclesInRegion(code);
  }

  @Public()
  @Get('muscles/:code')
  @ApiOperation({
    summary: 'Obtener detalle de un músculo',
    description:
      'Ícono, muscle_svg_parts con su coverage, y dos listas paginadas de ejercicios (donde el músculo es primary / donde es secondary)',
  })
  @ApiParam({
    name: 'code',
    description: 'Código del músculo',
    example: 'biceps_brachii',
  })
  @ApiResponse({ status: 200, description: 'Detalle del músculo' })
  @ApiResponse({ status: 404, description: 'Músculo no encontrado' })
  findMuscleDetail(
    @Param('code') code: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.exercisesService.findMuscleDetail(
      code,
      page ? Number(page) : undefined,
      pageSize ? Number(pageSize) : undefined,
    );
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
  findFullById(
    @Param('id', ParseIntPipe) id: number,
    @Query('locale') locale?: string,
  ) {
    return this.exercisesService.findFullById(id, locale ?? 'en');
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
