import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { RoutineService } from './routine.service';

@Controller('routine')
export class RoutineController {
  constructor(private readonly routineService: RoutineService) {}

  @Post()
  create(@Body() body) {
    return this.routineService.create(body);
  }

  @Get()
  findAll() {
    return this.routineService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.routineService.findOne(Number(id));
  }
  @Post(':id/exercises')
  addExercise(
    @Param('id') routineId: string,
    @Body() body: { exerciseId: number },
  ) {
    return this.routineService.addExerciseToRoutine(
      Number(routineId),
      body.exerciseId,
    );
  }
}