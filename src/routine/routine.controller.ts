import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { RoutineService } from './routine.service';

@Controller('routine')
export class RoutineController {
  constructor(private readonly workoutsService: RoutineService) {}

  @Post()
  create(@Body() body) {
    return this.workoutsService.create(body);
  }

  @Get()
  findAll() {
    return this.workoutsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workoutsService.findOne(Number(id));
  }
}