# DATABASE-ARCHITECTURE

## Purpose

The database strategy: engine, how the schema is bootstrapped vs evolved, how seeds work, and how the runner tracks state.

## When to read

Before any schema or data change.

## Keep updated

- When the schema strategy or bootstrap/migration approach changes.

## Engine & hosting

PostgreSQL, hosted as an **Azure Database for PostgreSQL** instance (`DB_HOST` in `backend/.env`, e.g. `pg-havit-dev-01.postgres.database.azure.com`). All application tables live in the `havit` schema (not `public`). `gen_random_uuid()` is used for UUID primary keys — built into PostgreSQL 13+ core, no `pgcrypto` extension needed.

## Schema lifecycle

```
backend/database/
  init/          # one-time base schema (currently one file: the full 38-table schema)
  migrations/     # every schema change since init, one file per change
  seeds/           # reference/lookup data (currently empty)
  scripts/          # the runner: lib.js, migrate.js, baseline.js, new-migration.js
```

`npm run db:migrate` (from `backend/`) applies every file not yet recorded in the `havit.schema_migrations` tracking table, walking `init/` → `migrations/` → `seeds/` in that order, files sorted lexically within each folder (which is chronological given the `YYYY-MM-DD-NN-name.sql` naming). Each file runs in its own transaction; a failing file is rolled back and stops the run, and is never marked applied. This runs automatically on every start via `backend/Dockerfile`'s `CMD` and `../raiz/docker-compose.yml`'s `command` — no manual step, no docker-compose registration per migration.

`npm run db:baseline` is the one-time exception: it records every current file as applied **without executing it**, for a database whose schema pre-dates this system (used once, for the existing Azure DB — see root `CLAUDE.md`).

TypeORM never touches the schema at runtime (`synchronize: false` in `src/app.module.ts`). The legacy `npm run migration:*` CLI (`src/data-source.ts`, `src/migrations/*.migration.ts`) is frozen/historical.

## Ownership model

No multi-tenancy. Tables that belong to a user carry a direct `user_id`/`created_by_user_id` foreign key, frequently nullable with `ON DELETE SET NULL` so deleting a user doesn't cascade-delete content they created (e.g. `challenges.created_by_user_id`, `routines.created_by_user_id`). Tables that belong to the user themselves (not content they created) use `ON DELETE CASCADE` (e.g. `user_profiles.user_id`, `workout_logs.user_id`).

## Conventions

- Naming: `snake_case` tables/columns, FK constraints named `fk_<table>_<referenced>`, check constraints `ck_<table>_<rule>`, unique constraints `uq_<table>_<columns>`, indexes `idx_<table>_<columns>`.
- Primary keys: `UUID DEFAULT gen_random_uuid()` for user-facing aggregate roots (`users`, `challenges`, `workout_posts`, `spaces`, `direct_conversations`); `BIGINT GENERATED ALWAYS AS IDENTITY` for catalog/join/log tables (`exercises`, `routines`, `workout_logs`, `notifications`, etc.).
- Timestamps: `TIMESTAMP` (no timezone), `DEFAULT CURRENT_TIMESTAMP` where relevant. No `updated_at` convention observed — most tables only have `created_at` or none.
- No generic soft-delete; some tables have an explicit `is_active BOOLEAN` instead (e.g. `challenge_invites`, `user_follows`, `workout_posts`).

> Must reflect the real current database, not assumptions.
