# SEEDING-GUIDE

## Purpose

What the seed files populate, in what order, and which data is required reference data vs sample/demo data.

## When to read

Before adding or changing seed data, or setting up a fresh environment.

## Keep updated

- When seed files are added/changed/removed or their order changes.

## Seed files (in order)

None exist yet (`backend/database/seeds/` is empty apart from `.gitkeep`). Scaffold one with `npm run db:new -- seed <short-name>` from `backend/` when the app needs reference data seeded.

## Likely first candidates (reference data, needed for the app to be usable, not yet seeded anywhere)

| Table | Why it needs seeding |
| --- | --- |
| `metric_types` | Catalog of measurable values (reps, weight, seconds, ...); `exercise_metrics`/`*_targets`/`*_metrics` rows FK into it |
| `exercise_categories` | Referenced by `exercise_category_map` |
| `exercise_locations` | Referenced by `exercise_location_map` |
| `body_parts` | Self-referencing hierarchy; referenced by `exercise_body_part_map` |
| `notification_types` | Referenced by `notifications.notification_type_id` (once the notifications module exists — see `docs/ai/CURRENT-STATE.md`) |
| `exercises` | The actual exercise catalog content itself |

## Ordering & dependencies

Seeds run after `init` and all `migrations`, in filename order. Within seeds, respect FK dependency order: catalog/lookup tables (`metric_types`, `exercise_categories`, `exercise_locations`, `body_parts`) before any table that references them (`exercise_metrics`, `exercise_category_map`, etc.).

## Reference vs sample data

No sample/demo data exists or is planned yet — everything above is required reference data, not demo content. If demo/sample rows are added later (e.g. sample challenges for a staging environment), keep them clearly separated (e.g. a `seeds/*-sample-*.sql` naming convention) so they're easy to exclude from a real deploy.

> Must reflect the real current seed files, not assumptions.
