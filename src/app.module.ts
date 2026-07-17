import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
import { validateEnv } from './config/env.validation';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    // `validate` fails the app fast at startup (instead of booting and then
    // 500ing on the first request) when a required env var is missing. See
    // src/config/env.validation.ts.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),

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
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      autoLoadEntities: true,
      schema: 'havit',
      synchronize: false,
      ssl: {
        // Azure Postgres requires TLS; cert verification stays off by
        // default (matches current behavior) until the Azure CA cert is
        // wired in as an infra follow-up — do NOT flip this to `true`
        // without that cert, it will break every connection. Set
        // DB_SSL_REJECT_UNAUTHORIZED=true only once that's in place.
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
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
    // Standard error shape { statusCode, error, message, code?, timestamp,
    // path } for every thrown exception, including unhandled ones. See
    // docs/ai/backend/ERROR-HANDLING.md.
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // One log line per request (method/path/status/duration), no bodies.
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}