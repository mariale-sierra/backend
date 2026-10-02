import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from './cache/cache.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChallengesModule } from './challenges/challenges.module';
import { ChallengeInvitesModule } from './challenge-invites/challenge-invites.module';
import { ExercisesModule } from './exercises/exercises.module';
import { RoutineModule } from './routine/routine.module';
import { WorkoutLogModule } from './workout-log/workout-log.module';
import { MetricsModule } from './metrics/metrics.module';
import { WorkoutPostsModule } from './workout-posts/workout-posts.module';
import { FollowsModule } from './follows/follows.module';
import { BadgesModule } from './badges/badges.module';
import { UploadsModule } from './uploads/uploads.module';
import { OpenAiModule } from './openai/openai.module';
import { ChatsModule } from './chats/chats.module';
import { SpacesModule } from './spaces/spaces.module';
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

    // Powers WorkoutPostsService's @Cron moderation batch job.
    ScheduleModule.forRoot(),

    // Modest global rate limit (hardening, Fase 1): protects against basic
    // abuse/flooding without affecting normal mobile app usage patterns.
    // ttl/limit are env-overridable (defaults unchanged) purely so B6's load
    // tests (backend/performance/) can raise the ceiling for a benchmark run
    // without every request from one IP tripping 429s — see
    // backend/performance/METHODOLOGY.md. Never set THROTTLE_* in a real
    // deployment; there's no legitimate reason to loosen this outside a
    // benchmark environment.
    //
    // B1: storage defaults to @nestjs/throttler's own in-memory Map, which
    // is per-process — correct for today's single-instance deployment, but
    // would silently become `limit × instance count` the moment the backend
    // runs as more than one container behind a load balancer (flagged as
    // B6's own "Future work #3"). When REDIS_URL is set, every instance
    // shares one real counter in Redis instead — same env var, same
    // zero-risk/env-gated rollout as RedisCacheService itself (unset =
    // old in-memory behavior, no code change needed to roll back). See
    // backend/performance/B1-REDIS.md.
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          {
            name: 'default',
            ttl: parseInt(process.env.THROTTLE_TTL_MS ?? '60000', 10),
            limit: parseInt(process.env.THROTTLE_LIMIT ?? '300', 10),
          },
        ],
        storage: process.env.REDIS_URL
          ? new ThrottlerStorageRedisService(process.env.REDIS_URL)
          : undefined,
      }),
    }),

    TypeOrmModule.forRoot({
      type: 'postgres',
      // B1 (PgBouncer): the app's runtime connection goes through
      // DB_POOL_HOST/DB_POOL_PORT when set — PgBouncer sitting in front of
      // Azure Postgres — defaulting to DB_HOST/DB_PORT (the direct
      // connection) when unset, same zero-risk/env-gated rollout as
      // REDIS_URL. database/scripts/migrate.js (DDL, baseline, fixtures)
      // deliberately keeps using DB_HOST/DB_PORT directly, bypassing the
      // pool — see backend/performance/B1-PGBOUNCER.md.
      // `||`, not `??`: an env var passed through Docker Compose as
      // `${DB_POOL_HOST:-}` (unset in .env) arrives as an actual empty
      // string, not undefined — `??` would keep that empty string instead
      // of falling back to DB_HOST. Confirmed live while testing the
      // PgBouncer rollout (backend/performance/B1-PGBOUNCER.md).
      host: process.env.DB_POOL_HOST || process.env.DB_HOST,
      port: parseInt(
        process.env.DB_POOL_PORT || process.env.DB_PORT || '5432',
        10,
      ),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      autoLoadEntities: true,
      schema: 'havit',
      synchronize: false,
      // Azure Postgres requires TLS (default). A local Postgres container does
      // not speak SSL, so set DB_SSL=false to disable it for local dev only.
      ssl:
        process.env.DB_SSL === 'false'
          ? false
          : {
              // Cert verification stays off by default (matches current
              // behavior) until the Azure CA cert is wired in as an infra
              // follow-up — do NOT flip this to `true` without that cert, it
              // will break every connection. Set
              // DB_SSL_REJECT_UNAUTHORIZED=true only once that's in place.
              rejectUnauthorized:
                process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
            },
      // PgBouncer (transaction pooling) now does the heavy multiplexing
      // across instances; this just bounds how many connections THIS
      // process's own `pg` pool opens against whatever it's pointed at.
      extra: { max: parseInt(process.env.DB_POOL_SIZE ?? '10', 10) },
    }),
    CacheModule,
    AuthModule,
    UsersModule,
    ChallengesModule,
    ChallengeInvitesModule,
    ExercisesModule,
    RoutineModule,
    WorkoutLogModule,
    MetricsModule,
    WorkoutPostsModule,
    FollowsModule,
    BadgesModule,
    UploadsModule,
    OpenAiModule,
    ChatsModule,
    SpacesModule,
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
