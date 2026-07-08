# FUNCTIONS-TRIGGERS-GUIDE

## Purpose

Database-side logic: stored functions, triggers, and notable constraints — what they do and why (business intent).

## When to read

Before changing schema logic, scheduling, or anything that may interact with a trigger/function.

## Keep updated

- When a function, trigger, or notable constraint is added/changed/removed.

## Functions

None. No PL/pgSQL functions are defined in `backend/database/init/` or `backend/database/migrations/` today — all business logic (e.g. "one progress record per day per challenge") is enforced in the NestJS service layer, not the database.

## Triggers

None.

## Notable constraints

- **"Exactly one value" pattern:** every `*_targets`/`*_metrics` table (`routine_exercise_set_targets`, `routine_exercise_targets`, `workout_log_exercise_targets`, `workout_log_exercise_metrics`, `workout_log_exercise_set_targets`, `workout_log_exercise_set_metrics`) has a `CHECK` requiring exactly one of `{target_value_int, target_value_decimal, target_value_text, target_value_seconds, target_value_boolean}` (or the `value_*` equivalents) to be non-null — a manual sum-of-booleans `CHECK`, not a Postgres-native "exactly one of" construct.
- **`ck_user_follows_not_self`** — a user cannot follow themselves.
- **`ck_challenge_invites_not_self`** — sender ≠ recipient on a challenge invite.
- **Partial unique indexes:**
  - `uq_challenge_invite_pending` — at most one pending, active invite per (challenge, sender, recipient).
  - `uq_exercise_category_primary` / `uq_exercise_location_primary` (added by a migration, not the base init) — at most one `is_primary = true` category/location per exercise.
- **`workout_posts.workout_log_id` UNIQUE** — enforces the 1:1 between a workout log and its social post.

If a future migration adds a real function/trigger (e.g. an `updated_at` auto-touch trigger, or a computed-progress function), document it here with its business purpose and which migration file defines it.

> Must reflect the real current functions/triggers/constraints, not assumptions.
