import { Controller, Get, Post, Body, Param} from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Exercises')
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Post()
  @ApiOperation({ summary: 'Crear nuevo ejercicio', description: 'Crea un nuevo ejercicio en la base de datos' })
  @ApiResponse({ status: 201, description: 'Ejercicio creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  create(@Body() body) {
    return this.exercisesService.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los ejercicios', description: 'Lista todos los ejercicios disponibles' })
  @ApiResponse({ status: 200, description: 'Lista de ejercicios' })
  findAll() {
    return this.exercisesService.findAll();
  }
}
