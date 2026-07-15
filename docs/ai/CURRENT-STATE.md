# CURRENT-STATE

## Purpose

A snapshot of what is actually built, in progress, or broken **right now**. Prevents re-doing finished work or assuming something exists that doesn't.

## When to read

At the start of any task, right after ARCHITECTURE.

## Keep updated

- Whenever a feature's status changes (new → in progress → done → broken).
- Whenever something is discovered to be broken or incomplete.

## Status legend

- ✅ Done / stable
- 🚧 In progress
- 🧪 Experimental / partial
- ❌ Broken / known issue
- 📐 Planned (see ROADMAP)

## Feature status

| Feature / module | Status | Notes |
| --- | --- | --- |
| Auth (`auth`) | ✅ | JWT login/register/`me`, `bcrypt` hashing, `JwtAuthGuard`. |
| Users (`users`) | ✅ | `GET /users/me`, `GET /users/me/challenges`. |
| Challenges (`challenges`) | ✅ | CRUD, join/leave/complete, cycle-day updates, progress + progress-summary, today's routine. |
| Exercises (`exercises`) | ✅ | Catalog CRUD-ish (`create`, `list`, `:id/full`), category/location/body-part relations. |
| Routines (`routine`) | ✅ | Create routine, attach exercises, fetch today's routine per challenge. |
| Workout logs (`workout-log`) | ✅ | Create, finish, list, progress submission (bundles metrics + evidence image). |
| Metrics (`metrics`) | ✅ | List metric types, add metrics to a workout-log exercise. |
| Workout posts (`workout-posts`) | 🧪 | Controller currently only exposes `GET /workout-posts/mosaic`. Post creation appears to happen through `workout-log`'s `POST /workout-logs/progress` (which accepts `imageUrl`/`caption`/`visibility`, per `backend/README.md`), not a dedicated create endpoint here — verify against `workout-posts.service.ts`/`workout-log.service.ts` before assuming otherwise. `workout_post_likes` (DB table) has no backend module yet. |
| Uploads (`uploads`) | ✅ | `POST /uploads/sign` issues a signed URL; frontend PUTs the image directly (see `frontend` `services/uploads/upload.service.ts`). |
| OpenAI moderation (`openai`) | ✅ | `moderation.service.ts`, wired into workout post moderation columns (`moderation_status`/`moderation_reason`/`moderated_at`). |
| Social/follows, spaces (group chat), direct messaging, notifications | 📐 | Tables exist in the SQL schema (`user_follows`, `spaces`, `space_members`, `space_messages`, `direct_conversations`, `direct_conversation_members`, `direct_messages`, `notification_types`, `notifications`, `challenge_invites`) but **no backend module/entity/controller exists for any of them yet**. Matches the frontend, where `messaging/`, `notifications`, `social`, `spaces` component folders are still just `.gitkeep` + empty barrel files. |
| Database migration system (`backend/database/`) | ✅ | Added 2026-07-07: SQL-file runner (`init/`/`migrations/`/`seeds/` + `havit.schema_migrations` tracking), replacing ad-hoc schema management. See `docs/ai/db/`. |
| Legacy TypeORM migrations (`src/migrations/*.migration.ts`, `src/data-source.ts`) | 🗑️ removed | Deleted 2026-07-15 (Fase 4) — both schema-affecting migrations were already ported forward into `backend/database/migrations/`. `npm run migration:generate\|run\|revert` no longer exist. `backend/database/` is now the only schema-management path. |
| Global error shape / exception filter | ✅ | Added 2026-07-15 (Fase 4): `HttpExceptionFilter` (`src/common/filters/`) produces `{ statusCode, error, message, code?, timestamp, path }` for every thrown/unhandled exception. See `docs/ai/backend/ERROR-HANDLING.md`. |
| Request logging | ✅ | Added 2026-07-15 (Fase 4): `LoggingInterceptor` (`src/common/interceptors/`) logs method/path/status/duration per request, never bodies. |
| Env validation | ✅ | Added 2026-07-15 (Fase 4): `ConfigModule.forRoot({ validate })` (`src/config/env.validation.ts`) fails fast at startup if `DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE`/`JWT_SECRET` are missing. |

## Known security gaps (being fixed in restructure)

The API currently has real, verified authentication/authorization gaps — most write endpoints have no guard at all, `GET /users/me` leaks `password_hash`, `POST /workout-logs` trusts a `userId` from the request body, and `/uploads/sign` is fully public with no allow-list. These are tracked in detail, with exact file/line references and a remediation checklist, in [`SECURITY.md`](./SECURITY.md) — read it before touching auth, ownership, or any endpoint that reads/writes user data. Do not assume any endpoint is safe by default; verify against that doc.

## Known issues & debt

- No response envelope or pagination convention anywhere in the API — every list endpoint returns a raw array with no `limit`/`offset`/`cursor` support. Will need a decision before the dataset (challenges, exercises, feed) grows.
- `src/common/` now exists (`filters/`, `interceptors/`, `constants/`) — introduced 2026-07-15 once a second cross-cutting concern (logging) joined the exception filter. `JwtAuthGuard` is still the only guard.
- `main.ts`'s `ValidationPipe` block has some odd formatting/whitespace (harmless, just untidy) — not a functional issue.
- Social/messaging/notifications features are DB-schema-only; building them is real backend work (module + entities + controller), not just wiring existing pieces.
- `CreateChallengeDto` still carries dead `categories`/`locations`/`cycle_days` fields (`any[]`, unused by `ChallengesService`) — **cannot be removed without a frontend change**: `frontend/services/adapters/createChallengePayloadAdapter.ts` sends all three on every real challenge creation; removing them would 400 every request under `forbidNonWhitelisted`. See `docs/ai/backend/API-STANDARDS.md`.
- No new ORM relations were added in Fase 5 (`Challenge`→`ChallengeUserMap`/`ChallengeCycleDay`, `ChallengeUserMap`→`User`, `WorkoutLog`→`User`/`Challenge` are still joined manually via `QueryBuilder`/explicit `where` clauses, not TypeORM relations) — deferred; see `DECISIONS.md`.
- `tsconfig.typeorm.json` is now unused (the `typeorm` npm script that referenced it was removed alongside the legacy migration system) but was left in place — outside this pass's write scope.

> This document must reflect the real current codebase, not assumptions.
