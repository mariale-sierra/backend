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

  async getTodayRoutine(
  challengeId: string,
  userId: string,
) {

  const today =
  await this.challengeService.getToday(
    challengeId,
    userId,
  );

  if (!today.hasWorkout) {
  return {
    hasWorkout: false,
    routine: null,
  };
  }

  const exercises =
  await this.routineExerciseRepo
    .createQueryBuilder('re')

    .leftJoinAndSelect(
      're.exercise',
      'exercise',
    )

    .leftJoinAndSelect(
      're.sets',
      'sets',
    )

    .leftJoinAndSelect(
      'sets.targets',
      'setTargets',
    )

    .leftJoinAndSelect(
      'setTargets.metricType',
      'setMetricType',
    )

    .leftJoinAndSelect(
      're.targets',
      'targets',
    )

    .leftJoinAndSelect(
      'targets.metricType',
      'targetMetricType',
    )

    .where(
      're.routine_id = :routineId',
      {
        routineId: today.routine_id,
      },
    )

    .orderBy('re.order_index', 'ASC')
    .addOrderBy('sets.set_number', 'ASC')

    .getMany();
    return {
    hasWorkout: true,
    currentDay: today.currentDay,
    currentDayInCycle:
      today.currentDayInCycle,
    routine_id: today.routine_id,
    exercises,
  };
}
}