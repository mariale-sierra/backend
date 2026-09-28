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
import { WorkoutPostReportsController } from './workout-post-reports.controller';
import { WorkoutPostReportsService } from './workout-post-reports.service';
import { ContentReport } from './entities/content-report.entity';
import { UserPenalty } from './entities/user-penalty.entity';
import { OpenAiModule } from '../openai/openai.module';
import { FollowsModule } from '../follows/follows.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkoutPost,
      WorkoutPostLike,
      WorkoutPostComment,
      ContentReport,
      UserPenalty,
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
    WorkoutPostReportsController,
  ],
  providers: [
    WorkoutPostsService,
    WorkoutPostReactionsService,
    WorkoutPostCommentsService,
    WorkoutPostReportsService,
  ],
  exports: [WorkoutPostsService],
})
export class WorkoutPostsModule {}
