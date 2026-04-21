import { Injectable } from '@nestjs/common';

@Injectable()
export class RoutineService {
  private workouts: any[] = [];

  create(workoutDto: any) {
    const workout = {
      id: Date.now(),
      name: workoutDto.name,
      exercises: [], 
    };

    this.workouts.push(workout);

    return {
      message: 'Workout created successfully',
      workout,
    };
  }

  findAll() {
    return this.workouts;
  }

  findOne(id: number) {
    return this.workouts.find(w => w.id === id);
  }
}