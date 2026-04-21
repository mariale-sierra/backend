import { Injectable, OnModuleInit } from '@nestjs/common';

@Injectable()
export class ExercisesService implements OnModuleInit {
  private exercises: any[] = [];

  //Creación de la pool, 4 ejercicio que aparecen siempre aunque no hayan ejercicios.
  onModuleInit() {
    if (this.exercises.length === 0){
      this.exercises.push(
        {
          id: Date.now(),
          name: 'Push Up',
          muscle_group: 'chest',
          difficulty: 'easy',
        },
        {
          id: Date.now() + 1,
          name: 'Squat',
          muscle_group: 'legs',
          difficulty: 'medium',
        },
        {
          id: Date.now() + 2,
          name: 'Pull Up',
          muscle_group: 'back',
          difficulty: 'hard',
        },
        {
          id: Date.now() + 3,
          name: 'Plank',
          muscle_group: 'core',
          difficulty: 'medium',
        }
      );
    }
  }

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
