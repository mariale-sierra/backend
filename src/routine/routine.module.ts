import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Routine } from './entities/routine.entity';
import { RoutineExercise } from './entities/routine-exercise.entity';
import { Exercise } from '../exercises/entities/exercise.entity';

import { RoutineService } from './routine.service';
import { RoutineController } from './routine.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Routine,
      RoutineExercise,
      Exercise, 
    ]),
  ],
  controllers: [RoutineController],
  providers: [RoutineService],
})
export class RoutineModule {}