import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkoutLog } from './entities/workout-log.entity';
import { Exercise } from '../exercises/entities/exercise.entity';
import { WorkoutLogExercise } from './entities/workout-log-exercise.entity';

@Injectable()
export class WorkoutLogExerciseService {
  constructor(

    @InjectRepository(Exercise)
    private exerciseRepo: Repository<Exercise>,

    @InjectRepository(WorkoutLog)
    private workoutRepo: Repository<WorkoutLog>,

    @InjectRepository(WorkoutLogExercise)
    private wleRepo: Repository<WorkoutLogExercise>,
  ) {}

  async addExercise(workoutId: number, exerciseId: number) {
  const workout = await this.workoutRepo.findOneBy({ id: workoutId });
  if (!workout) throw new Error('Workout not found');

  const exercise = await this.exerciseRepo.findOneBy({ id: exerciseId });
  if (!exercise) throw new Error('Exercise not found');

  const entry = this.wleRepo.create({
    workout,
    exercise,
  });

  return this.wleRepo.save(entry);
}

}