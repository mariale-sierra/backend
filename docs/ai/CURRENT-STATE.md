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
| Legacy TypeORM migrations (`src/migrations/*.migration.ts`) | ❌ frozen | Superseded by `backend/database/`. Kept only for history; do not extend. |

## Known security gaps (being fixed in restructure)

The API currently has real, verified authentication/authorization gaps — most write endpoints have no guard at all, `GET /users/me` leaks `password_hash`, `POST /workout-logs` trusts a `userId` from the request body, and `/uploads/sign` is fully public with no allow-list. These are tracked in detail, with exact file/line references and a remediation checklist, in [`SECURITY.md`](./SECURITY.md) — read it before touching auth, ownership, or any endpoint that reads/writes user data. Do not assume any endpoint is safe by default; verify against that doc.

## Known issues & debt

- No response envelope or pagination convention anywhere in the API — every list endpoint returns a raw array with no `limit`/`offset`/`cursor` support. Will need a decision before the dataset (challenges, exercises, feed) grows.
- No `common/` folder for shared guards/interceptors/filters/pipes — the only guard is `JwtAuthGuard`. If a second cross-cutting concern shows up, that's the point to introduce one, not before.
- `main.ts`'s `ValidationPipe` block has some odd formatting/whitespace (harmless, just untidy) — not a functional issue.
- Social/messaging/notifications features are DB-schema-only; building them is real backend work (module + entities + controller), not just wiring existing pieces.

> This document must reflect the real current codebase, not assumptions.
