import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChallengesModule } from './challenges/challenges.module';
import { ExercisesModule } from './exercises/exercises.module';
import { RoutineModule } from './routine/routine.module';
import { WorkoutLogModule } from './workout-log/workout-log.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: 5432,
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      autoLoadEntities: true,
      schema: 'havit',
      synchronize: false,
      ssl: {
        rejectUnauthorized: false,
      },
    }),
    AuthModule, 
    UsersModule,
    ChallengesModule,
    ExercisesModule,
    RoutineModule,
    WorkoutLogModule,
    MetricsModule,
    MetricsModule,
  ],
})
export class AppModule {}