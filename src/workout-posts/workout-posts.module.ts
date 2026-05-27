import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkoutPostsService } from './workout-posts.service';
import { WorkoutPost } from './entities/workout-post.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { WorkoutPostsController } from './workout-posts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WorkoutPost, WorkoutLog])],
  controllers: [WorkoutPostsController],
  providers: [WorkoutPostsService],
  exports: [WorkoutPostsService],
})
export class WorkoutPostsModule {}
