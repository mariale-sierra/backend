import { Module } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { ExercisesController } from './exercises.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Exercise } from './entities/exercise.entity';
import { ExerciseMetric } from './entities/exercise-metric.entity';
import { MetricType } from '../metrics/entities/metric-type.entity';
import { ExerciseCategory } from './entities/exercise-category.entity';
import { ExerciseLocation } from './entities/exercise-location.entity';
import { ExerciseBodyPart } from './entities/exercise-body-part.entity';
import { ExerciseCategoryMap } from './entities/exercise-category-map.entity';
import { ExerciseLocationMap } from './entities/exercise-location-map.entity';
import { ExerciseBodyPartMap } from './entities/exercise-body-part-map.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Exercise,
      ExerciseMetric,
      MetricType,
      ExerciseCategory,
      ExerciseLocation,
      ExerciseBodyPart,
      ExerciseCategoryMap,
      ExerciseLocationMap,
      ExerciseBodyPartMap,
    ]),
  ],
  controllers: [ExercisesController],
  providers: [ExercisesService],
})
export class ExercisesModule {}
