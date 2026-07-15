# TASKS-LOG

## Purpose

A chronological log of completed work. Lighter than CHANGES.md — it answers "what has been done and when," giving future sessions a trail of context.

## When to read

When you need history on how the repo reached its current state, or to avoid repeating a task.

## Keep updated

- After completing any meaningful task, append an entry (newest at top).

## Log

### 2026-07-14 — Fase 1 security hardening (Agent 3: global auth, ownership, uploads, CORS/Helmet/throttler)
- **What:** implemented the restructuring plan's Fase 1 (P0 security) on branch `restructure/hardening`: global `JwtAuthGuard` via `APP_GUARD` with a `@Public()` decorator for the explicit catalog/auth allow-list; a `@CurrentUser()` param decorator and `assertOwnership()` helper (`src/auth/decorators/`, `src/auth/utils/`); per-user ownership checks on challenges (update/remove/cycle-day), workout-logs (get/finish/list), metrics (addMetric), and routine (create owner override + addExercise ownership); stripped `password_hash` from `/users/me` via a new `UserResponseDto`; removed `email` from `GET /challenges/:id/users`; secured `POST /uploads/sign` with an allow-list DTO, per-user key prefix, and try/catch; added `helmet()`, explicit CORS, and a global + login-specific throttle in `main.ts`/`app.module.ts`; fixed the duplicate `MetricsModule` import and wired the previously-unregistered `AppController` into `AppModule`.
- **Why:** close the P0 security gaps identified in the master restructuring plan (§1, §3.1, §9 Fase 1) — unauthenticated writes, `password_hash` leakage, `userId` trusted from request bodies, open presigned-upload endpoint, no CORS/Helmet/rate-limiting.
- **Files:** `src/main.ts`, `src/app.module.ts`, `src/auth/guards/jwt-auth.guard.ts`, `src/auth/decorators/public.decorator.ts` (new), `src/auth/decorators/current-user.decorator.ts` (new), `src/auth/utils/assert-ownership.ts` (new), `src/auth/auth.controller.ts`, `src/app.controller.ts`, `src/users/users.controller.ts`, `src/users/users.service.ts`, `src/users/dto/user-response.dto.ts` (new), `src/challenges/challenges.controller.ts`, `src/challenges/challenges.service.ts`, `src/workout-log/workout-log.controller.ts`, `src/workout-log/workout-log.service.ts`, `src/workout-log/dto/create-workout-log.dto.ts` (new), `src/metrics/metrics.controller.ts`, `src/metrics/metrics.service.ts`, `src/uploads/uploads.controller.ts`, `src/uploads/uploads.service.ts`, `src/uploads/dto/sign-upload.dto.ts` (new), `src/routine/routine.controller.ts`, `src/routine/routine.service.ts`, `src/exercises/exercises.controller.ts`, `package.json` (added `helmet`, `@nestjs/throttler`).
- **Verified:** `npm run build` clean; ran the built app against the real Azure dev DB and smoke-tested with two throwaway registered users covering auth allow-list, ownership 403/200 on challenges/workout-logs/routine, `password_hash` absence, email removal on challenge participants, and the uploads MIME allow-list. Full contract-delta table is in the Agent 3 session report for the frontend team (Fase 2).
- **Not done (explicitly out of scope, left for other Fases):** `new Error()` → HTTP exception cleanup outside the exact lines touched by ownership checks, response envelope, global exception filter, DTO cleanup unrelated to security, `expo-secure-store` (frontend), the duplicated `POST /challenges/progress` vs `POST /workout-logs/progress` routes (recorded for Fase 2/4 consolidation), backfilling `createdByUserId` on legacy routines (Fase 5).

### 2026-07-07 — Built the `backend/database/` migration system
- **What:** created `init/`, `migrations/`, `seeds/`, `scripts/{lib,migrate,baseline,new-migration}.js`; ported the schema snapshot and the two legacy TypeORM migrations into it; wired `npm run db:migrate` into `Dockerfile` and `../raiz/docker-compose.yml`; added `db:migrate`/`db:baseline`/`db:new` npm scripts.
- **Why:** requested to move schema management under version-controlled, dated SQL migrations with automatic application, instead of ad-hoc changes against the shared Azure database.
- **Files:** `backend/database/**`, `backend/Dockerfile`, `backend/package.json`, `../raiz/docker-compose.yml`, root `CLAUDE.md`.

### 2026-07-07 — Adapted the four `app-builder` skills and bootstrapped `docs/ai/`
- **What:** rewrote `app-builder`, `app-builder-backend`, `app-builder-db`, `app-builder-frontend` (`SKILL.md` + `templates/`) from their Klyro-platform originals to Havit's real stack; created this `docs/ai/` tree (general + `backend/` + `db/` subfolders) with real content instead of empty templates; created `backend/database/DB-INSTRUCTIONS.md`.
- **Why:** the skills were copied from another project and referenced patterns (DDD layering, multi-tenancy, a different DB migration mechanism) that don't exist here; without adapting them and giving them real docs to read, they would have misled future sessions.
- **Files:** `.claude/skills/app-builder*/**`, `backend/docs/ai/**`, `backend/database/DB-INSTRUCTIONS.md`.

> This log must reflect work actually completed, not assumptions.
