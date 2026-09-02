import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpacesService } from './spaces.service';
import { SpacesController } from './spaces.controller';
import { Space } from './entities/space.entity';
import { SpaceMember } from './entities/space-member.entity';
import { SpaceJoinRequest } from './entities/space-join-request.entity';
import { ExerciseCategory } from '../exercises/entities/exercise-category.entity';
import { User } from '../users/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Space,
      SpaceMember,
      SpaceJoinRequest,
      ExerciseCategory,
      User,
    ]),
    forwardRef(() => AuthModule),
  ],
  controllers: [SpacesController],
  providers: [SpacesService],
  exports: [SpacesService],
})
export class SpacesModule {}
