# MAP — Where Things Live

## Purpose

A fast lookup index from "thing I need to change" to "file/folder where it lives." Use this to locate code **before** searching the codebase randomly.

## When to read

Whenever you need to find where something is implemented.

## Keep updated

- Whenever files, modules, routes, or folders are added, moved, renamed, or removed.
- This is the most frequently-updated doc — keep it honest.

## Directory overview

| Path | What lives here |
| --- | --- |
| `src/<module>/` | One folder per domain module (see table below) |
| `src/app.module.ts` | Root module: `TypeOrmModule.forRoot`, `ConfigModule`, imports every feature module |
| `src/main.ts` | Bootstrap: `ValidationPipe`, Swagger setup (`/api-docs`), port/listen |
| `src/data-source.ts` | Legacy TypeORM CLI data source (`npm run migration:*`) — frozen, see `docs/ai/db/` |
| `src/migrations/` | Legacy hand-written TypeORM migrations — frozen, ported into `database/migrations/` |
| `database/` | Canonical SQL schema/migrations/seeds + runner — see `docs/ai/db/DB-MAP.md` |
| `test/` | Jest e2e config/specs |
| `swagger.json` | Checked-in snapshot of the generated OpenAPI spec |
| `docs/ai/` | This documentation tree |

## Feature → module

| Feature | Module path | Base route |
| --- | --- | --- |
| Auth (login/register/me) | `src/auth/` | `/auth` |
| Users | `src/users/` | `/users` |
| Challenges | `src/challenges/` | `/challenges` |
| Exercises catalog | `src/exercises/` | `/exercises` |
| Routines | `src/routine/` | `/routine` |
| Workout logs / progress | `src/workout-log/` | `/workout-logs` |
| Metrics | `src/metrics/` | `/metrics` |
| Workout posts | `src/workout-posts/` | `/workout-posts` |
| Uploads (signed URLs) | `src/uploads/` | `/uploads` |
| OpenAI moderation | `src/openai/` | (no controller — used internally by `workout-posts`) |

## Entry points

- App bootstrap: `src/main.ts`.
- Root module: `src/app.module.ts`.
- DB connection config: `src/app.module.ts`'s `TypeOrmModule.forRoot` (env: `DB_HOST`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`, schema `havit`).
- Docker: `Dockerfile` (build + `db:migrate` + start), consumed locally by `../raiz/docker-compose.yml`.

> This map must reflect the real current codebase, not assumptions. If you used it and an entry was wrong or missing, fix it.
