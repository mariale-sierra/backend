import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { Challenge } from '../challenges/entities/challenge.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengeCategoryMap } from '../challenges/entities/challenge-category-map.entity';
import { ChallengeLocationMap } from '../challenges/entities/challenge-location-map.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Challenge,
      ChallengeUserMap,
      WorkoutLog,
      ChallengeCategoryMap,
      ChallengeLocationMap,
    ]),
    forwardRef(() => AuthModule),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}