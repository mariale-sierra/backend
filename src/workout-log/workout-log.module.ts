import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkoutLogService } from './workout-log.service';
import { WorkoutLogController } from './workout-log.controller';
import { WorkoutLog } from './entities/workout-log.entity';
import { WorkoutLogExercise } from './entities/workout-log-exercise.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { Exercise } from '../exercises/entities/exercise.entity';
import { WorkoutLogExerciseMetric } from '../metrics/entities/workout-log-exercise-metric.entity';
import { AuthModule } from '../auth/auth.module';
import { WorkoutPost } from 'src/workout-posts/entities/workout-post.entity';
import { WorkoutPostsModule } from '../workout-posts/workout-posts.module';
import { OpenAiModule } from '../openai/openai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkoutLog,
      WorkoutLogExercise,
      WorkoutLogExerciseMetric,
      RoutineExercise,
      Exercise,
      WorkoutPost,
    ]),
    AuthModule,
    WorkoutPostsModule,
    OpenAiModule,
  ],
  controllers: [WorkoutLogController],
  providers: [WorkoutLogService],
  exports: [WorkoutLogService],
})
export class WorkoutLogModule {}
