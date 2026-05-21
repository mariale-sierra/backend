import { Module } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { ExercisesController } from './exercises.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Exercise } from './entities/exercise.entity';
import { ExerciseMetric } from './entities/exercise-metric.entity';
import { MetricType } from '../metrics/entities/metric-type.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Exercise, ExerciseMetric, MetricType])],
  controllers: [ExercisesController],
  providers: [ExercisesService],
})
export class ExercisesModule {}