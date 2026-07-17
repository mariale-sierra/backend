import { Module } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { ChallengesController } from './challenges.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Challenge } from './entities/challenge.entity';
import { User } from '../users/entities/user.entity';
import { ChallengeUserMap } from './entities/challenge-user-map.entity';
import { AuthModule } from '../auth/auth.module';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { WorkoutLogModule } from '../workout-log/workout-log.module';
import { ChallengeCycleDay } from './entities/challenge-cycle-days.entity';
import { Routine } from '../routine/entities/routine.entity';
import { ChallengeCategoryMap } from './entities/challenge-category-map.entity';
import { ChallengeLocationMap } from './entities/challenge-location-map.entity';
import { ExerciseCategory } from '../exercises/entities/exercise-category.entity';
import { ExerciseLocation } from '../exercises/entities/exercise-location.entity';
import { ExerciseCategoryMap } from '../exercises/entities/exercise-category-map.entity';
import { ExerciseLocationMap } from '../exercises/entities/exercise-location-map.entity';
import { ExerciseMetric } from '../exercises/entities/exercise-metric.entity';
import { Exercise } from '../exercises/entities/exercise.entity';
import { MetricType } from '../metrics/entities/metric-type.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { RoutineExerciseSet } from '../routine/entities/routine-exercise-set.entity';
import { RoutineExerciseTarget } from '../routine/entities/routine-exercise-target.entity';
import { RoutineExerciseSetTarget } from '../routine/entities/routine-exercise-set-target.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Challenge,
      User,
      ChallengeUserMap,
      WorkoutLog,
      ChallengeCycleDay,
      Routine,
      ChallengeCategoryMap,
      ChallengeLocationMap,
      ExerciseCategory,
      ExerciseLocation,
      ExerciseCategoryMap,
      ExerciseLocationMap,
      ExerciseMetric,
      Exercise,
      MetricType,
      RoutineExercise,
      RoutineExerciseSet,
      RoutineExerciseTarget,
      RoutineExerciseSetTarget,
    ]),
    AuthModule,
    WorkoutLogModule,
  ],
  controllers: [ChallengesController],
  providers: [ChallengesService],
  exports: [ChallengesService],
})
export class ChallengesModule {}
