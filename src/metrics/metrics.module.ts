import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricType } from './entities/metric-type.entity';
import { WorkoutLogExercise } from '../workout-log/entities/workout-log-exercise.entity';
import { WorkoutLogExerciseMetric } from './entities/workout-log-exercise-metric.entity';
import { ExerciseMetric } from '../exercises/entities/exercise-metric.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MetricType,
      WorkoutLogExercise,
      WorkoutLogExerciseMetric,
      ExerciseMetric,
    ]),
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
