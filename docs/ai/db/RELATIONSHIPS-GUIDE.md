# RELATIONSHIPS-GUIDE

## Purpose

How tables relate: foreign keys, cardinality, and the ownership chain back to a user.

## When to read

Before adding FKs, joins, or cascade rules.

## Keep updated

- When relationships, foreign keys, or cascade behavior change.

## Relationship table (key edges; see the init SQL for the exhaustive list)

| From (FK) | To (PK) | Cardinality | On delete | Meaning |
| --- | --- | --- | --- | --- |
| `user_profiles.user_id` | `users.id` | 1—1 | CASCADE | Profile dies with the user |
| `challenges.created_by_user_id` | `users.id` | N—1 | SET NULL | Challenge survives its creator's deletion |
| `challenge_user_map.{challenge_id,user_id}` | `challenges.id`, `users.id` | N—N | CASCADE | Participation record |
| `challenge_cycle_days.challenge_id` | `challenges.id` | N—1 | CASCADE | Cycle day belongs to exactly one challenge |
| `challenge_cycle_days.routine_id` | `routines.id` | N—1 | SET NULL | Routine can be unassigned without deleting the cycle day |
| `routine_exercises.routine_id` | `routines.id` | N—1 | CASCADE | |
| `routine_exercises.exercise_id` | `exercises.id` | N—1 | RESTRICT | Can't delete an exercise that's used in a routine |
| `workout_logs.user_id` | `users.id` | N—1 | CASCADE | Logs die with the user |
| `workout_logs.{routine_id,challenge_id,challenge_cycle_day_id}` | respective tables | N—1 | SET NULL | Log survives if the routine/challenge/cycle-day is removed |
| `workout_log_exercises.workout_log_id` | `workout_logs.id` | N—1 | CASCADE | |
| `workout_posts.workout_log_id` | `workout_logs.id` | **1—1** | CASCADE | Unique constraint on `workout_log_id`; a log has at most one post |
| `workout_posts.user_id` | `users.id` | N—1 | CASCADE | |
| `user_follows.{follower_user_id,followed_user_id}` | `users.id` (both) | N—N | CASCADE | `CHECK (follower_user_id <> followed_user_id)` — can't follow yourself |
| `spaces.created_by_user_id` | `users.id` | N—1 | **RESTRICT** | Creator can't be deleted while the space exists (different from `challenges`' SET NULL) |
| `notifications.recipient_user_id` | `users.id` | N—1 | CASCADE | |
| `notifications.actor_user_id` | `users.id` | N—1 | SET NULL | The actor can be deleted without deleting the notification |

## Ownership chain

Everything traces back to a `user`, directly or through one hop — there is no multi-level tenant hierarchy. Examples:
- `workout_log_exercise_set_metrics` → `workout_log_exercise_sets` → `workout_log_exercises` → `workout_logs` → `users`.
- `routine_exercise_set_targets` → `routine_exercise_sets` → `routine_exercises` → `routines` → `users` (creator, nullable).

No business/branch/tenant table or column exists anywhere in the schema.

## Diagram

No ER diagram file is maintained for this project. This file + `TABLES-GUIDE.md` are the source of truth; add a diagram here only if it becomes genuinely necessary, and keep it manually in sync (nothing generates it automatically).

> Must reflect the real current relationships, not assumptions.
