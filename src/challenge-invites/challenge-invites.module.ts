import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChallengeInvitesService } from './challenge-invites.service';
import { ChallengeInvitesController } from './challenge-invites.controller';
import { ChallengeInvite } from './entities/challenge-invite.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { User } from '../users/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChallengeInvite,
      Challenge,
      ChallengeUserMap,
      User,
    ]),
    AuthModule,
  ],
  controllers: [ChallengeInvitesController],
  providers: [ChallengeInvitesService],
  exports: [ChallengeInvitesService],
})
export class ChallengeInvitesModule {}
