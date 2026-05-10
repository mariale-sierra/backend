import { Module } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { ChallengesController } from './challenges.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Challenge } from './entities/challenge.entity';
import { User } from '../users/entities/user.entity';
import { ChallengeUserMap } from './entities/challenge-user-map.entity';
import { AuthModule } from '../auth/auth.module';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Challenge, User, ChallengeUserMap, WorkoutLog]),
    AuthModule,
  ],
  controllers: [ChallengesController],
  providers: [ChallengesService, ],
})
export class ChallengesModule {}