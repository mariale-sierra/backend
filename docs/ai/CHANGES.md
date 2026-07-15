# CHANGES

## Purpose

A changelog of meaningful changes to `backend/`, newest first. Lets a new session see what changed recently so it doesn't undo or conflict with recent work.

## When to read

At the start of any task, right after MAP — to know what just changed.

## Keep updated

- After every meaningful change, append an entry at the top.

## Changelog

### 2026-07-15
- **Changed:** added a global `HttpExceptionFilter` (`src/common/filters/http-exception.filter.ts`, `@Catch()`, registered as `APP_FILTER`) that turns every thrown exception — including unhandled ones — into the standard shape `{ statusCode, error, message, code?, timestamp, path }`. Added a small `ErrorCode` enum + status→code default map (`src/common/constants/error-code.enum.ts`): `AUTH_REQUIRED`/`FORBIDDEN`/`NOT_FOUND`/`VALIDATION_ERROR`/`INTERNAL`, auto-assigned from the HTTP status unless the exception specifies its own `code`.
- **Reason:** Fase 4 — no exception filter existed; errors used Nest's bare default shape with no stable machine-readable code, and unhandled errors leaked as opaque 500s.
- **Impact:** `message` and HTTP status are unchanged in meaning for every existing error — the frontend's status-only Axios interceptor keeps working unmodified. Response bodies gain `code`/`timestamp`/`path`, which is additive.
- **Changed:** added a global `LoggingInterceptor` (`src/common/interceptors/logging.interceptor.ts`, registered as `APP_INTERCEPTOR`) — one line per request (method/path/status/duration) via Nest's `Logger`, never request bodies.
- **Reason:** Fase 4 — no request logging existed beyond one ad-hoc `Logger` in `challenges.service.ts`.
- **Changed:** replaced the last two `new Error(...)` sites (`src/routine/routine.service.ts` — `addExerciseToRoutine`) with `NotFoundException`. Deleted the dead, unregistered `WorkoutLogExerciseService` (`src/workout-log/workout-log-exercise.service.ts`), which had the other two `new Error(...)` sites — confirmed via grep it was never imported/provided anywhere. `workout-log.service.ts`'s two originally-flagged sites had already been fixed incidentally during Fase 1's ownership work.
- **Reason:** Fase 4 — these produced opaque 500s instead of 404s, hiding the real cause from the client.
- **Impact:** `POST /routine/:id/exercises` with a bad routine/exercise id now correctly returns 404 instead of 500. No behavior change from deleting `WorkoutLogExerciseService` (it had no callers).
- **Changed:** deleted the legacy TypeORM migration system: `src/migrations/*.migration.ts` (both files, already ported into `backend/database/migrations/`), `src/data-source.ts` (confirmed unimported anywhere in `src/`), and removed `migration:generate`/`migration:run`/`migration:revert` + the `typeorm` helper script from `package.json`.
- **Reason:** Fase 4 — `backend/database/` has been the canonical schema-management system since 2026-07-07; keeping the frozen TypeORM CLI around risked someone reaching for the wrong tool.
- **Impact:** none — `backend/database/`'s runner (`npm run db:migrate`) is untouched and remains the only schema-management path. `tsconfig.typeorm.json` was left in place (unused now) — outside this pass's write scope.
- **Changed:** `app.module.ts` — `TypeOrmModule.forRoot`'s `port` now reads `parseInt(process.env.DB_PORT ?? '5432', 10)` instead of a hardcoded `5432`; `ssl.rejectUnauthorized` now reads `process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'` (defaults to `false`, same as before — **not** flipped to `true`, that needs the Azure CA cert as a separate infra step). Added `ConfigModule.forRoot({ validate: validateEnv })` (`src/config/env.validation.ts`) — the app now refuses to boot with a clear error if `DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE`/`JWT_SECRET` are missing, instead of booting and failing on the first DB query/JWT operation.
- **Reason:** Fase 4 — hardcoded port, unconditional `rejectUnauthorized: false`, and no fail-fast config validation were all flagged in the master plan.
- **Impact:** none for the current `.env` (already has `DB_PORT=5432`, no `DB_SSL_REJECT_UNAUTHORIZED` set → same `false` default as before).
- **Changed:** `challenges.service.ts` — extracted the cycle-day/date math duplicated across `getProgress`/`getToday`/`getProgressSummary` into two private helpers, `calculateCurrentDay(joinedAt)` and `calculateCurrentDayInCycle(currentDay, cycleLengthDays)`. Behavior unchanged (same math, same call sites, same validation).
- **Reason:** Fase 4 — the exact same ~10-line block was copy-pasted three times.
- **Changed:** added the last missing request DTOs: `CreateExerciseDto` (`src/exercises/dto/`, `POST /exercises`), `CreateRoutineDto` (`src/routine/dto/`, `POST /routine` — `createdByUserId` kept optional/ignored so the frontend's current payload doesn't 400), `AddRoutineExerciseDto` (`src/routine/dto/`, `POST /routine/:id/exercises`), `AddMetricDto` (`src/metrics/dto/`, `POST /metrics/workout-log-exercises/:id`). All replace previously-untyped `@Body() body`/inline object-literal params.
- **Reason:** Fase 5 — the last four endpoints taking untyped bodies, bypassing `ValidationPipe` entirely.
- **Impact:** matched field-for-field against what the frontend actually sends (`frontend/services/routine/routine.service.ts`, `frontend/services/metrics/metrics.service.ts`, `frontend/types/routine.ts`, `frontend/types/workout-log.ts`) — no frontend change needed. `POST /exercises` has no current frontend caller; the DTO was modeled directly off the `Exercise` entity's writable columns.
- **Skipped (see `DECISIONS.md` for full rationale):** removing `CreateChallengeDto`'s dead `categories`/`locations`/`cycle_days` fields — the frontend actively sends them on every real challenge creation; removing would 400 every request. New ORM relations (Fase 5 item 11) — deferred, no test coverage to verify against the live schema safely in this pass.

### 2026-07-14
- **Changed:** registered `JwtAuthGuard` as a global `APP_GUARD` (deny-by-default auth) plus a `@Public()` decorator (`src/auth/decorators/public.decorator.ts`) for the explicit allow-list: `POST /auth/login`, `POST /auth/register`, `GET /`, `GET /challenges`, `GET /challenges/:id`, `GET /exercises`, `GET /exercises/:id/full`, `GET /metrics`. Every other route now requires a valid JWT even if it previously had no `@UseGuards` at all.
- **Reason:** most of the write surface (and several reads) had no auth at all — P0 risk #1 in the restructuring plan.
- **Impact:** `POST /exercises`, `POST /exercises/:id/relations`, `GET/POST /routine*`, `GET /workout-posts/mosaic`, `POST /uploads/sign`, `GET /workout-logs*` now require `Authorization: Bearer <token>`. The mobile app already attaches the token on every authenticated request, so this is transparent for logged-in users.
- **Changed:** added per-user ownership enforcement (`src/auth/utils/assert-ownership.ts`, throws `ForbiddenException`) on `PATCH/DELETE /challenges/:id`, `PATCH /challenges/:id/cycle-days/:dayInCycle` (creator only), `GET/PATCH /workout-logs/:id` and `PATCH /workout-logs/:id/finish` (log owner only), `POST /metrics/workout-log-exercises/:id` (parent log owner only), and `POST /routine/:id/exercises` (routine owner, only when the routine has a recorded owner — many legacy routines have `createdByUserId = null`, flagged for Fase 5).
- **Reason:** several endpoints let any authenticated user read/mutate another user's data (P0 risk #1/#3 — data leakage across users, `userId` trusted from the body).
- **Impact:** `GET /workout-logs` (list) is now always scoped to `req.user.sub` — it used to return every user's logs. `POST /workout-logs` and `POST /routine` now always derive the owner from the JWT and ignore any `userId`/`createdByUserId` sent in the body.
- **Changed:** `GET /users/me` and `GET /users/me` (via `UsersService.findById`) now select only `id, username, email, is_active` and map through a new `UserResponseDto` (`src/users/dto/user-response.dto.ts`) instead of returning the raw `User` entity — `password_hash` is no longer fetched or returned. Verified `POST /auth/login`/`POST /auth/register` payloads were already clean.
- **Reason:** P0 risk #2 — `GET /users/me` was leaking the bcrypt hash.
- **Impact:** none for the frontend; response is a strict subset of the previous shape.
- **Changed:** `GET /challenges/:id/users` now requires auth and no longer selects `user.email` in `ChallengesService.findUsersByChallenge`.
- **Reason:** it exposed participant emails to any caller, authenticated or not.
- **Impact:** frontend doesn't currently call this route (grepped, no callers) — zero risk of breakage.
- **Changed:** `POST /uploads/sign` now requires auth, validates `fileType` against an allow-list (`image/jpeg`, `image/png`, `image/webp`) via `SignUploadDto`, prefixes the R2 object key with the caller's user id (`uploads/<userId>/<uuid>.<ext>`), and wraps `getSignedUrl`/`PutObjectCommand` in try/catch (`InternalServerErrorException` instead of an unhandled AWS SDK error).
- **Reason:** P0 risk #1 — anyone could mint presigned write URLs to the R2 bucket for any content type.
- **Impact:** frontend already sends `{ fileType: 'image/jpeg' | 'image/png' }`, which is within the allow-list, and already attaches the auth token — no frontend change needed.
- **Changed:** `main.ts` now applies `helmet()` and explicit `app.enableCors({ origin: CORS_ORIGINS env or reflect-origin, methods, allowedHeaders })`; `app.module.ts` registers a modest global `ThrottlerModule` (300 req/min per client) plus a tighter `@Throttle({ limit: 10, ttl: 60_000 })` on `POST /auth/login`. Installed `helmet` and `@nestjs/throttler` (added to `package.json`).
- **Reason:** brief F6/master-plan hardening — no CORS/Helmet/rate-limit existed at all.
- **Impact:** none expected for the Expo/React Native client (not subject to CORS); Swagger UI and any future web client get reflected-origin CORS by default unless `CORS_ORIGINS` is set.
- **Changed:** fixed the duplicate `MetricsModule` import in `app.module.ts` and wired `AppController`/`AppService` into `AppModule` (they were never registered — `GET /` was returning 404 even before this change, discovered while smoke-testing the new `@Public()` tag on it) plus explicitly imported `OpenAiModule`.
- **Reason:** explicitly-permitted adjacent cleanup while already editing `app.module.ts`, plus the `GET /` public route from task 1 needed the controller to actually be reachable.
- **Impact:** `GET /` now returns `200 "Hello World!"` instead of `404`.
- **Verification:** `npm run build` clean; built app started successfully against the real Azure dev DB and was smoke-tested end-to-end with two throwaway registered users — confirmed 401 without a token on protected routes, 200 on the public allow-list, 403 for a non-owner on challenge update/delete, workout-log get/finish, and routine addExercise, 200/201 for the owner on the same actions, `password_hash` absent from `/users/me` and `/auth/me`, `GET /challenges/:id/users` without `email`, `POST /uploads/sign` rejecting a disallowed MIME type with 400. Test data cleaned up (challenges deleted); two throwaway test user rows remain in the shared dev DB.

### 2026-07-07
- **Changed:** introduced `backend/database/` as the canonical, versioned schema system (`init/`, `migrations/`, `seeds/`, `scripts/{migrate,baseline,new-migration,lib}.js`), tracked via a new `havit.schema_migrations` table. Wired into `backend/Dockerfile` and `raiz/docker-compose.yml` so it runs automatically on every start. Ported the two schema-affecting legacy TypeORM migrations (`workout-post-moderation`, `primary-exercise-relations`) forward as idempotent SQL files.
- **Reason:** replace ad-hoc/undocumented schema management with a system any session can use safely against the shared Azure Postgres DB, following an explicit date-indexed naming convention.
- **Impact:** `npm run migration:generate|run|revert` (TypeORM CLI) is now legacy/frozen — new schema work goes through `npm run db:new` + `npm run db:migrate` instead. See `docs/ai/db/`.
- **Changed:** added `backend/database/DB-INSTRUCTIONS.md` and adapted the `app-builder`/`app-builder-backend`/`app-builder-db`/`app-builder-frontend` skills (originally copied from the Klyro platform) to Havit's real architecture: flat modules (no use-cases/mappers/repositories/common), no multi-tenancy (per-user ownership only), and the new DB runner instead of `docker-entrypoint-initdb.d` mounts.
- **Reason:** the copied skills assumed a different stack/architecture (Klyro's DDD-layered, multi-tenant NestJS backend and Next.js frontend) and would have misled future sessions if left as-is.
- **Impact:** `docs/ai/` bootstrapped for the first time in this repo (this file included) — keep it current from here on.

> This changelog must reflect real changes to the codebase, not assumptions.
