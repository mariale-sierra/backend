import { Injectable } from '@nestjs/common';

@Injectable()
export class ExercisesService {
  private exercises: any[] = [];

  create(exerciseDto: any) {
    const exercise = {
      id: Date.now(),
      ...exerciseDto,
    };

    this.exercises.push(exercise);

    return {
      message: 'Exercise created successfully',
      exercise,
    };
  }

  findAll() {
    return this.exercises;
  }
}
