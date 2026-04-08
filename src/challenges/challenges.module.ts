import { Module } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { ChallengesController } from './challenges.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Challenge } from './entities/challenge.entity';
import { User } from '../users/entities/user.entity';
import { ChallengeUserMap } from './entities/challenge-user-map.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Challenge, User, ChallengeUserMap])],
  controllers: [ChallengesController],
  providers: [ChallengesService],
})
export class ChallengesModule {}
