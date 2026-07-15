import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChallengesModule } from './challenges/challenges.module';
import { ExercisesModule } from './exercises/exercises.module';
import { RoutineModule } from './routine/routine.module';
import { WorkoutLogModule } from './workout-log/workout-log.module';
import { MetricsModule } from './metrics/metrics.module';
import { WorkoutPostsModule } from './workout-posts/workout-posts.module';
import { UploadsModule } from './uploads/uploads.module';
import { OpenAiModule } from './openai/openai.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Modest global rate limit (hardening, Fase 1): protects against basic
    // abuse/flooding without affecting normal mobile app usage patterns.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 300,
      },
    ]),

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
    WorkoutPostsModule,
    UploadsModule,
    OpenAiModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Deny-by-default: every route requires a valid JWT unless annotated
    // with @Public(). See src/auth/decorators/public.decorator.ts.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}