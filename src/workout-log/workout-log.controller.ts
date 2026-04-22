import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { WorkoutLogService } from './workout-log.service';

@Controller('workout-logs')
export class WorkoutLogController {
  constructor(private readonly service: WorkoutLogService) {}

  @Post()
  create(@Body() body: { routineId?: number; userId: string }) {
    return this.service.createWorkout(body);
  }

  @Patch(':id/finish')
  finish(@Param('id') id: string) {
    return this.service.finishWorkout(Number(id));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(Number(id));
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }
}