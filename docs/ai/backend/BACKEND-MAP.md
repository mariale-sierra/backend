# BACKEND-MAP

## Purpose

Locate backend code fast: modules, controllers, services, entities, DTOs.

## When to read

Whenever you need to find where a backend thing lives.

## Keep updated

- When modules, services, or routes are added/moved/removed.

## Modules

| Module | Path | Responsibility |
| --- | --- | --- |
| Auth | `src/auth/` | Login/register/me, JWT issuing, `JwtAuthGuard` |
| Users | `src/users/` | Current user profile, enrolled challenges |
| Challenges | `src/challenges/` | Challenge CRUD, join/leave/complete, cycle days, progress |
| Exercises | `src/exercises/` | Exercise catalog, categories/locations/body-part relations |
| Routine | `src/routine/` | Routine creation, attaching exercises, today's routine |
| Workout log | `src/workout-log/` | Workout sessions, progress submission, finishing |
| Metrics | `src/metrics/` | Metric type catalog, recording metrics per workout-log exercise |
| Workout posts | `src/workout-posts/` | Social feed mosaic (creation currently via `workout-log` progress, see `docs/ai/CURRENT-STATE.md`) |
| Uploads | `src/uploads/` | Signed URL issuance for S3/Cloudflare-compatible storage |
| OpenAI | `src/openai/` | Content moderation service, used by workout-posts flow |

## Controllers → routes

| Controller | Base route | Endpoints |
| --- | --- | --- |
| `auth.controller.ts` | `/auth` | `POST /login`, `POST /register`, `GET /me` |
| `users.controller.ts` | `/users` | `GET /me`, `GET /me/challenges` |
| `challenges.controller.ts` | `/challenges` | `POST /`, `GET /`, `GET /progress`, `POST /progress`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `POST /:id/join`, `PATCH /:id/leave`, `PATCH /:id/complete`, `PATCH /:id/cycle-days/:dayInCycle`, `GET /:id/users`, `GET /:id/today`, `GET /:id/progress-summary` |
| `exercises.controller.ts` | `/exercises` | `POST /`, `GET /`, `GET /:id/full`, `POST /:id/relations` |
| `routine.controller.ts` | `/routine` | `POST /`, `GET /`, `GET /:id`, `POST /:id/exercises`, `GET /today/:challengeId` |
| `workout-log.controller.ts` | `/workout-logs` | `POST /`, `PATCH /:id/finish`, `GET /`, `POST /progress`, `GET /:id` |
| `metrics.controller.ts` | `/metrics` | `GET /`, `POST /workout-log-exercises/:id` |
| `workout-posts.controller.ts` | `/workout-posts` | `GET /mosaic` |
| `uploads.controller.ts` | `/uploads` | `POST /sign` |
| `app.controller.ts` | `/` | Default Nest health/hello route |

## Entities (by module)

- `challenges/entities/`: `challenge.entity.ts`, `challenge-user-map.entity.ts`, `challenge-cycle-days.entity.ts`
- `exercises/entities/`: `exercise.entity.ts`, `exercise-category.entity.ts`, `exercise-category-map.entity.ts`, `exercise-location.entity.ts`, `exercise-location-map.entity.ts`, `exercise-body-part.entity.ts`, `exercise-body-part-map.entity.ts`, `exercise-metric.entity.ts`
- `metrics/entities/`: `metric-type.entity.ts`, `workout-log-exercise-metric.entity.ts`
- `routine/entities/`: `routine.entity.ts`, `routine-exercise.entity.ts`, `routine-exercise-set.entity.ts`, `routine-exercise-target.entity.ts`, `routine-exercise-set-target.entity.ts`
- `users/entities/`: `user.entity.ts`, `user-profile.entity.ts`
- `workout-log/entities/`: `workout-log.entity.ts`, `workout-log-exercise.entity.ts`, `workout-log-exercise-set.entity.ts`, `workout-log-exercise-target.entity.ts`, `workout-log-exercise-set-target.entity.ts`
- `workout-posts/entities/`: `workout-post.entity.ts`

No entities exist yet for `user_follows`, `workout_post_likes`, `spaces`/`space_members`/`space_messages`, `direct_conversations`/`direct_conversation_members`/`direct_messages`, `notification_types`/`notifications`, `challenge_invites` (SQL tables exist, backend doesn't model them yet — see `docs/ai/CURRENT-STATE.md`).

## Auth building blocks

| Concern | Path |
| --- | --- |
| JWT guard | `src/auth/guards/jwt-auth.guard.ts` |
| Auth service/controller | `src/auth/auth.service.ts`, `src/auth/auth.controller.ts` |

## Cross-cutting (`src/common/`, `src/config/`)

Introduced in Fase 4 — the first cross-cutting concerns beyond the auth guard, so a shared folder became warranted (see `CURRENT-STATE.md`'s prior note that one didn't exist yet).

| Concern | Path |
| --- | --- |
| Global exception filter (standard error shape) | `src/common/filters/http-exception.filter.ts` |
| Error code catalog | `src/common/constants/error-code.enum.ts` |
| Global request logging interceptor | `src/common/interceptors/logging.interceptor.ts` |
| Fail-fast env validation for `ConfigModule.forRoot` | `src/config/env.validation.ts` |

Both the filter and interceptor are registered as `APP_FILTER`/`APP_INTERCEPTOR` in `src/app.module.ts`, alongside the existing `APP_GUARD` registrations.

## Removed (Fase 4)

- `src/workout-log/workout-log-exercise.service.ts` (`WorkoutLogExerciseService`) — deleted. It was never registered in any module's `providers`/`controllers` and had no callers; the two `new Error(...)` sites it contained went with it.
- `src/migrations/*.migration.ts`, `src/data-source.ts` — deleted. The legacy TypeORM migration system is fully retired; `backend/database/` (see `docs/ai/db/`) is the only schema-management path now. `npm run migration:generate|run|revert` (and the `typeorm` helper script) were removed from `package.json`. `tsconfig.typeorm.json` was left in place (now unused) — it wasn't in this pass's write scope (`src/**` + `package.json` only).

> Must reflect the real current backend, not assumptions.
