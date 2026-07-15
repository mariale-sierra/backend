# CHANGES

## Purpose

A changelog of meaningful changes to `backend/`, newest first. Lets a new session see what changed recently so it doesn't undo or conflict with recent work.

## When to read

At the start of any task, right after MAP — to know what just changed.

## Keep updated

- After every meaningful change, append an entry at the top.

## Changelog

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
