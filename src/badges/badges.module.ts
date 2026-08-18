import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadgesService } from './badges.service';
import { BadgesController } from './badges.controller';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { User } from '../users/entities/user.entity';
import { UserProfile } from '../users/entities/user-profile.entity';
import { FollowsModule } from '../follows/follows.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkoutLog, ChallengeUserMap, User, UserProfile]),
    FollowsModule,
  ],
  controllers: [BadgesController],
  providers: [BadgesService],
  exports: [BadgesService],
})
export class BadgesModule {}
