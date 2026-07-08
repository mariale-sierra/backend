# TASKS-LOG

## Purpose

A chronological log of completed work. Lighter than CHANGES.md — it answers "what has been done and when," giving future sessions a trail of context.

## When to read

When you need history on how the repo reached its current state, or to avoid repeating a task.

## Keep updated

- After completing any meaningful task, append an entry (newest at top).

## Log

### 2026-07-07 — Built the `backend/database/` migration system
- **What:** created `init/`, `migrations/`, `seeds/`, `scripts/{lib,migrate,baseline,new-migration}.js`; ported the schema snapshot and the two legacy TypeORM migrations into it; wired `npm run db:migrate` into `Dockerfile` and `../raiz/docker-compose.yml`; added `db:migrate`/`db:baseline`/`db:new` npm scripts.
- **Why:** requested to move schema management under version-controlled, dated SQL migrations with automatic application, instead of ad-hoc changes against the shared Azure database.
- **Files:** `backend/database/**`, `backend/Dockerfile`, `backend/package.json`, `../raiz/docker-compose.yml`, root `CLAUDE.md`.

### 2026-07-07 — Adapted the four `app-builder` skills and bootstrapped `docs/ai/`
- **What:** rewrote `app-builder`, `app-builder-backend`, `app-builder-db`, `app-builder-frontend` (`SKILL.md` + `templates/`) from their Klyro-platform originals to Havit's real stack; created this `docs/ai/` tree (general + `backend/` + `db/` subfolders) with real content instead of empty templates; created `backend/database/DB-INSTRUCTIONS.md`.
- **Why:** the skills were copied from another project and referenced patterns (DDD layering, multi-tenancy, a different DB migration mechanism) that don't exist here; without adapting them and giving them real docs to read, they would have misled future sessions.
- **Files:** `.claude/skills/app-builder*/**`, `backend/docs/ai/**`, `backend/database/DB-INSTRUCTIONS.md`.

> This log must reflect work actually completed, not assumptions.
