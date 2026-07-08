# DB-MAP

## Purpose

Locate database files fast: init script, migrations, seeds, and the runner scripts.

## When to read

Whenever you need to find a SQL file or DB folder.

## Keep updated

- When SQL files or database folders are added/moved/removed.

## Folders

| Path | What lives here |
| --- | --- |
| `backend/database/init/` | One-time base schema |
| `backend/database/migrations/` | Incremental schema changes, one file per change |
| `backend/database/seeds/` | Reference/lookup data (currently empty) |
| `backend/database/scripts/` | `lib.js` (shared helpers), `migrate.js`, `baseline.js`, `new-migration.js` |
| `backend/database/DB-INSTRUCTIONS.md` | Mandatory "read first" gate file for any DB change |

## Init

| File | Purpose |
| --- | --- |
| `2026-07-07-00-init-schema.sql` | Full base schema: 38 tables, all enums, FKs, checks, and recommended indexes across catalog/exercises, users, routines, challenges, workout logs, social/feed, spaces, direct messaging, and notifications |

## Migrations (in order)

| File | Purpose |
| --- | --- |
| `2025-02-19-01-workout-post-moderation.sql` | Adds `moderation_status`/`moderation_reason`/`moderated_at` to `workout_posts` (OpenAI moderation flow) |
| `2025-02-19-02-primary-exercise-relations.sql` | Enforces a single "primary" category/location per exercise via partial unique indexes on `exercise_category_map`/`exercise_location_map` |

## Seeds (in order)

None yet. Candidates when needed: `metric_types`, `exercise_categories`, `exercise_locations`, `notification_types`, the `exercises` catalog itself.

> Must reflect the real current database files, not assumptions.
