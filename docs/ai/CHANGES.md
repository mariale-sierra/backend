# CHANGES

## Purpose

A changelog of meaningful changes to `backend/`, newest first. Lets a new session see what changed recently so it doesn't undo or conflict with recent work.

## When to read

At the start of any task, right after MAP — to know what just changed.

## Keep updated

- After every meaningful change, append an entry at the top.

## Changelog

### 2026-07-07
- **Changed:** introduced `backend/database/` as the canonical, versioned schema system (`init/`, `migrations/`, `seeds/`, `scripts/{migrate,baseline,new-migration,lib}.js`), tracked via a new `havit.schema_migrations` table. Wired into `backend/Dockerfile` and `raiz/docker-compose.yml` so it runs automatically on every start. Ported the two schema-affecting legacy TypeORM migrations (`workout-post-moderation`, `primary-exercise-relations`) forward as idempotent SQL files.
- **Reason:** replace ad-hoc/undocumented schema management with a system any session can use safely against the shared Azure Postgres DB, following an explicit date-indexed naming convention.
- **Impact:** `npm run migration:generate|run|revert` (TypeORM CLI) is now legacy/frozen — new schema work goes through `npm run db:new` + `npm run db:migrate` instead. See `docs/ai/db/`.
- **Changed:** added `backend/database/DB-INSTRUCTIONS.md` and adapted the `app-builder`/`app-builder-backend`/`app-builder-db`/`app-builder-frontend` skills (originally copied from the Klyro platform) to Havit's real architecture: flat modules (no use-cases/mappers/repositories/common), no multi-tenancy (per-user ownership only), and the new DB runner instead of `docker-entrypoint-initdb.d` mounts.
- **Reason:** the copied skills assumed a different stack/architecture (Klyro's DDD-layered, multi-tenant NestJS backend and Next.js frontend) and would have misled future sessions if left as-is.
- **Impact:** `docs/ai/` bootstrapped for the first time in this repo (this file included) — keep it current from here on.

> This changelog must reflect real changes to the codebase, not assumptions.
