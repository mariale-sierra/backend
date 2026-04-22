import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkoutLogService } from './workout-log.service';
import { WorkoutLogController } from './workout-log.controller';
import { WorkoutLog } from './entities/workout-log.entity';
import { WorkoutLogExercise } from './entities/workout-log-exercise.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { Exercise } from '../exercises/entities/exercise.entity';
import { WorkoutLogExerciseMetric } from '../metrics/entities/workout-log-exercise-metric.entity';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkoutLog,
      WorkoutLogExercise,
      WorkoutLogExerciseMetric,
      RoutineExercise,
      Exercise,
    ]),
  ],
  controllers: [WorkoutLogController],
  providers: [WorkoutLogService],
})
export class WorkoutLogModule {}
