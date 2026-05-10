import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Routine } from './entities/routine.entity';
import { RoutineExercise } from './entities/routine-exercise.entity';
import { Exercise } from '../exercises/entities/exercise.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { ChallengesService } from '../challenges/challenges.service';

@Injectable()
export class RoutineService {
  constructor(
    private challengeService: ChallengesService,
    @InjectRepository(Routine)
    private routineRepo: Repository<Routine>,

    @InjectRepository(RoutineExercise)
    private routineExerciseRepo: Repository<RoutineExercise>,

    @InjectRepository(Exercise)
    private exerciseRepo: Repository<Exercise>,

    @InjectRepository(Challenge) 
    private challengeRepo: Repository<Challenge>,
  ) {}

  async create(dto: any) {
    const routine = this.routineRepo.create(dto);
    return this.routineRepo.save(routine);
  }

  async findAll() {
    return this.routineRepo.find({
      relations: ['routine_exercises', 'routine_exercises.exercise'],
    });
  }

  async findOne(id: number) {
    return this.routineRepo.findOne({
      where: { id },
      relations: ['routine_exercises', 'routine_exercises.exercise'],
    });
  }

  async addExerciseToRoutine(routineId: number, exerciseId: number) {
    const routine = await this.routineRepo.findOneBy({ id: routineId });
    if (!routine) throw new Error('Routine not found');

    const exercise = await this.exerciseRepo.findOneBy({ id: exerciseId });
    if (!exercise) throw new Error('Exercise not found');

    const existingCount = await this.routineExerciseRepo.count({
      where: { routine: { id: routineId } },
    });

    const routineExercise = this.routineExerciseRepo.create({
      routine,
      exercise,
      order_index: existingCount + 1,
    });

    return this.routineExerciseRepo.save(routineExercise);
  }

  async getTodayRoutine(userId: string, challengeId: string) {

  const routine = await this.routineRepo.findOne({
    relations: ['routineExercises', 'routineExercises.exercise'],
  });

  if (!routine) {
    throw new Error('No routine found');
  }

  return {
    day: 1, // temporal
    routineId: routine.id,
    exercises: (routine.routine_exercises || []).map((re, index) => ({
      id: re.exercise?.id ?? index,
      name: re.exercise?.name ?? 'Exercise',
      sets: 3,
    })),
  };
}
}