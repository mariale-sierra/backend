import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Routine } from './entities/routine.entity';
import { RoutineExercise } from './entities/routine-exercise.entity';
import { Exercise } from '../exercises/entities/exercise.entity';

import { RoutineService } from './routine.service';
import { RoutineController } from './routine.controller';
import { Challenge } from '../challenges/entities/challenge.entity';
import { ChallengesModule } from '../challenges/challenges.module';
import { AuthModule } from '../auth/auth.module';
import { RoutineExerciseSet } from './entities/routine-exercise-set.entity';
import { RoutineExerciseTarget } from './entities/routine-exercise-target.entity';
import { RoutineExerciseSetTarget } from './entities/routine-exercise-set-target.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Routine, RoutineExercise, RoutineExerciseSet,RoutineExerciseTarget,
    RoutineExerciseSetTarget,Exercise, Challenge]),
    ChallengesModule,AuthModule,
  ],
  controllers: [RoutineController],
  providers: [RoutineService],
})
export class RoutineModule {}