import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FollowsService } from './follows.service';
import { FollowsController } from './follows.controller';
import { UserFollow } from './entities/user-follow.entity';
import { User } from '../users/entities/user.entity';
import { UserProfile } from '../users/entities/user-profile.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // WorkoutLog/UserProfile are registered directly (not via
    // WorkoutLogModule/UsersModule) — same pattern BadgesModule/UsersModule
    // already use for cross-domain entities, so this doesn't introduce a
    // module import cycle (WorkoutLogModule -> WorkoutPostsModule already
    // imports FollowsModule).
    TypeOrmModule.forFeature([UserFollow, User, UserProfile, WorkoutLog]),
    forwardRef(() => AuthModule),
  ],
  controllers: [FollowsController],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
