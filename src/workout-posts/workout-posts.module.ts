import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkoutPostsService } from './workout-posts.service';
import { WorkoutPost } from './entities/workout-post.entity';
import { WorkoutPostLike } from './entities/workout-post-like.entity';
import { WorkoutPostComment } from './entities/workout-post-comment.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { User } from '../users/entities/user.entity';
import { WorkoutPostsController } from './workout-posts.controller';
import { FeedController } from './feed.controller';
import { WorkoutPostReactionsController } from './workout-post-reactions.controller';
import { WorkoutPostReactionsService } from './workout-post-reactions.service';
import { WorkoutPostCommentsController } from './workout-post-comments.controller';
import { WorkoutPostCommentsService } from './workout-post-comments.service';
import { OpenAiModule } from '../openai/openai.module';
import { FollowsModule } from '../follows/follows.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkoutPost,
      WorkoutPostLike,
      WorkoutPostComment,
      WorkoutLog,
      User,
    ]),
    OpenAiModule,
    FollowsModule,
  ],
  controllers: [
    WorkoutPostsController,
    FeedController,
    WorkoutPostReactionsController,
    WorkoutPostCommentsController,
  ],
  providers: [
    WorkoutPostsService,
    WorkoutPostReactionsService,
    WorkoutPostCommentsService,
  ],
  exports: [WorkoutPostsService],
})
export class WorkoutPostsModule {}
