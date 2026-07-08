# DOMAIN-MODEL

## Purpose

The business domain as the backend models it: core entities, their relationships, and the business rules/invariants that must always hold.

## When to read

Before changing entities, relationships, or business logic.

## Keep updated

- When domain entities, relationships, or business rules change. Keep aligned with `docs/ai/db/TABLES-GUIDE.md` — that file covers the full 38-table SQL schema; this one covers only the subset the backend currently models (see the gap list in `docs/ai/CURRENT-STATE.md`).

## Core entities

| Entity | Purpose (business) | Key fields | Owned by |
| --- | --- | --- | --- |
| `User` | An account holder | `username`, `email`, `password_hash`, `is_active` | itself |
| `UserProfile` | Public/visual profile info | `display_name`, `bio`, `preferred_language`, `profile_image_url`, `is_private` | `User` (1:1) |
| `Challenge` | A fitness challenge users can join and follow a routine cycle for | `name`, `visibility` (public/private), `duration_days`, `cycle_length_days` | creator (`created_by_user_id`, nullable) |
| `ChallengeUserMap` | A user's participation in a challenge | `role` (owner/participant), `status` (active/completed/left), `joined_at` | `User` × `Challenge` |
| `ChallengeCycleDay` | One day within a challenge's repeating cycle | `day_in_cycle`, `day_type` (workout/rest), optional `routine_id` | `Challenge` |
| `Routine` | A reusable set of exercises | `name`, `description` | creator (nullable) |
| `RoutineExercise` / `RoutineExerciseSet` / `RoutineExerciseTarget` / `RoutineExerciseSetTarget` | Planned exercises, their sets, and target metric values within a routine | `order_index`, `set_number`, `target_value_*` | `Routine` |
| `Exercise` | A catalog exercise | `name`, `slug`, `tracking_mode` (single/sets/interval/mixed) | n/a (global catalog) |
| `WorkoutLog` | An actual workout session a user performed | `started_at`, `ended_at`, `status` (in_progress/completed/cancelled) | `User`, optionally tied to a `Challenge`/`ChallengeCycleDay`/`Routine` |
| `WorkoutLogExercise` / `...Set` / `...Target` / `...SetTarget` | Real exercises/sets performed and the targets copied at logging time | mirrors the routine planning shape but as actuals | `WorkoutLog` |
| `MetricType` | A kind of measurable value (reps, weight, seconds, etc.) | `value_type` (int/decimal/text/seconds/boolean), `default_unit` | n/a (global catalog) |
| `WorkoutPost` | The social/evidence post attached to a workout log | `image_url`, `caption`, `visibility`, `moderation_status`/`moderation_reason`/`moderated_at` | `User`, 1:1 with `WorkoutLog` |

## Relationships

- `User` 1—1 `UserProfile`.
- `User` 1—N `ChallengeUserMap` N—1 `Challenge` (many-to-many through the map table, with `role`/`status`).
- `Challenge` 1—N `ChallengeCycleDay`, each optionally pointing at a `Routine`.
- `Routine` 1—N `RoutineExercise` 1—N `RoutineExerciseSet` 1—N `RoutineExerciseSetTarget` (and a parallel non-set path via `RoutineExerciseTarget` for exercises with `tracking_mode` other than `sets`).
- `WorkoutLog` mirrors that same shape as *actuals*: `WorkoutLog` 1—N `WorkoutLogExercise` 1—N `WorkoutLogExerciseSet` 1—N `WorkoutLogExerciseSetMetric`/`...SetTarget` (plus the non-set path).
- `WorkoutLog` 1—1 `WorkoutPost` (a workout log can have at most one social post — enforced by a DB unique constraint on `workout_posts.workout_log_id`).
- No tenant/business scoping anywhere — every ownership edge above is a direct FK to `users.id`, nullable with `ON DELETE SET NULL` where the row should survive its creator being deleted (e.g. `challenges.created_by_user_id`, `routines.created_by_user_id`).

## Business rules & invariants

- **One progress record per day per challenge** — enforced in `workout-log`/`challenges` services (see root `CLAUDE.md`).
- Progress is calculated dynamically from completed workouts, not stored as a precomputed percentage.
- A `WorkoutPost` requires an underlying `WorkoutLog`; images are referenced as URLs (uploaded via the `uploads` signed-URL flow), never stored as binary data in Postgres.
- `challenge_cycle_days.day_type` determines whether a day expects a workout (`routine_id` set) or is a rest day.

## Lifecycles / state machines

- `challenge_user_map.status`: `active` → `completed` | `left`.
- `workout_log.status`: `in_progress` → `completed` | `cancelled`.
- `workout_posts.moderation_status` (added via migration, not in the base schema snapshot): `pending` → `approved` | `rejected`, set by the OpenAI moderation flow (`src/openai/moderation.service.ts`).

> Must reflect the real current domain as implemented, not assumptions.
