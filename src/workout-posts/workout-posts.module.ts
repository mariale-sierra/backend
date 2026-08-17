import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkoutPostsService } from './workout-posts.service';
import { WorkoutPost } from './entities/workout-post.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { User } from '../users/entities/user.entity';
import { WorkoutPostsController } from './workout-posts.controller';
import { FeedController } from './feed.controller';
import { OpenAiModule } from '../openai/openai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkoutPost, WorkoutLog, User]),
    OpenAiModule,
  ],
  controllers: [WorkoutPostsController, FeedController],
  providers: [WorkoutPostsService],
  exports: [WorkoutPostsService],
})
export class WorkoutPostsModule {}
