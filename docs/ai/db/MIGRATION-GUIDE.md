# MIGRATION-GUIDE

## Purpose

How to change the schema safely.

## When to read

Before any schema change.

## Keep updated

- After adding a migration; when the migration process changes.

## Rules

- **Never edit an old/applied `init/`, `migrations/`, or `seeds/` file.** Once its filename is in `havit.schema_migrations`, it's immutable history.
- **Always create a new file** via `npm run db:new -- migration <short-name>` (run from `backend/`).
- **Write idempotent SQL** — `IF NOT EXISTS` on `CREATE TABLE`/`ALTER TABLE ADD COLUMN`, `DO $$ ... $$` guards on `CREATE TYPE` (Postgres has no `CREATE TYPE IF NOT EXISTS`). See `backend/database/migrations/2025-02-19-01-workout-post-moderation.sql` for the `DO` block pattern.
- No tenancy to preserve — keep the direct `user_id`/`created_by_user_id` ownership pattern for new user-owned tables.

## Naming & order

`YYYY-MM-DD-NN-short-name.sql`. `NN` is a 2-digit index that resets per day (so same-day files sort/apply in creation order). `npm run db:new` computes this automatically — don't hand-name a file.

## How migrations run

`backend/database/scripts/migrate.js` (`npm run db:migrate`):
1. Connects using `DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE` (same as `app.module.ts`), `ssl: { rejectUnauthorized: false }`.
2. Ensures `havit.schema_migrations (id, phase, filename UNIQUE, applied_at)` exists.
3. Applies every file under `init/` → `migrations/` → `seeds/` not yet in that table, each in its own transaction (commit together with its tracking row, or roll back and stop on failure).

Runs automatically via `backend/Dockerfile`'s `CMD` and `../raiz/docker-compose.yml`'s `command`, on every start. No docker-compose/Dockerfile edit is needed per migration — only if the runner mechanism itself changes.

`npm run db:baseline` marks current files as applied **without running them** — a one-time tool for pointing the system at a database whose schema pre-dates it. Never run it against a genuinely empty database.

## Adding a migration — checklist

- [ ] Inspected current schema (`init/` + existing `migrations/`) for the tables involved.
- [ ] Created a new file via `npm run db:new -- migration <name>`.
- [ ] Wrote idempotent SQL.
- [ ] Ran `npm run db:migrate` (or confirmed the next deploy/start will).
- [ ] Updated `TABLES-GUIDE.md`/`RELATIONSHIPS-GUIDE.md`/`DB-MAP.md` here.
- [ ] Updated the matching TypeORM entity in `backend/src/<module>/entities/` if the backend reads/writes the changed column (schema is not `synchronize`d).

> Must reflect the real current migration process, not assumptions.
