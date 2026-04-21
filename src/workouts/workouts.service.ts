import { Injectable } from '@nestjs/common';

@Injectable()
export class WorkoutsService {
  private workouts: any[] = [];

  create(workoutDto: any) {
    const workout = {
      id: Date.now(),
      name: workoutDto.name,
      exercises: [], // 👈 CLAVE
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