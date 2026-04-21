import { Controller, Get, Post, Body, Param} from '@nestjs/common';
import { ExercisesService } from './exercises.service';

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Post()
  create(@Body() body) {
    return this.exercisesService.create(body);
  }

  @Get()
  findAll() {
    return this.exercisesService.findAll();
  }
}
