# DECISIONS

## Purpose

A lightweight decision log (ADR-style). Records *why* important technical choices were made so future sessions don't unknowingly reverse them.

## When to read

When a change touches an architectural choice, or you're tempted to "do it differently."

## Keep updated

- Whenever a non-trivial technical decision is made, add an entry.
- If a decision is reversed, add a new entry that supersedes the old one (don't delete history).

## Decisions

### 2026-07-07 — Replace TypeORM CLI migrations with a raw-SQL runner under `backend/database/`
- **Context:** schema changes were split across a hand-maintained snapshot (`schema_havit_uuid.sql` at the `Havit/` root) and two hand-written TypeORM migration files (`src/migrations/*.migration.ts`), with no automated tracking of what had actually been applied to the shared Azure database, and no enforced naming/ordering convention.
- **Decision:** move to plain, dated SQL files under `backend/database/{init,migrations,seeds}/`, applied by a small custom Node script (`backend/database/scripts/migrate.js`) that tracks applied filenames in a `havit.schema_migrations` table, runs automatically on every container start, and requires no docker-compose wiring per migration.
- **Rationale:** the app already used raw SQL for its real schema (TypeORM `synchronize: false`); a file-per-change system with DB-side tracking is simpler to reason about than diffing TypeORM entities, and removes the need to manually register each migration in Docker config (the previous plan modeled on a `docker-entrypoint-initdb.d` approach, rejected because the target database is a managed Azure instance, not a local Postgres container).
- **Consequences:** `npm run migration:generate|run|revert` is now legacy/frozen. The existing Azure database needed a one-time `npm run db:baseline` to mark its current schema as already-applied without re-running `CREATE TABLE`/`CREATE TYPE` statements.
- **Status:** accepted.

### 2026-07-07 — Adapt the `app-builder*` skills from Klyro to Havit instead of using them as-is
- **Context:** four `app-builder` skills (general, backend, db, frontend) were copied in from a different project ("Klyro"), which assumed a DDD-layered NestJS backend with `use-cases/`/`mappers/`/`repositories/`/`common/`, multi-tenant business/branch isolation, a Next.js/shadcn/TanStack Query frontend, an 8-language i18n setup, and a `docker-entrypoint-initdb.d`-mounted database with a `root/` platform repo.
- **Decision:** rewrite the four `SKILL.md` files and their `templates/` to describe Havit's actual architecture (flat NestJS modules, no tenancy, Expo Router/React Native frontend with no form/query library, 2-language i18n, the new `backend/database/` runner) rather than leaving Klyro-specific assumptions in place.
- **Rationale:** using the skills unmodified would have actively misled future sessions into inventing layers, tenancy checks, and libraries that don't exist in this codebase.
- **Consequences:** `docs/ai/` had to be bootstrapped from scratch in both `backend/` and `frontend/` for the skills' Step 1 ("read docs/ai first") to have anything real to read.
- **Status:** accepted.

> This log must reflect real decisions affecting the codebase, not assumptions.
