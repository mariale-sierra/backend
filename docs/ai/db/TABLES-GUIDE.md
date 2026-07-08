# TABLES-GUIDE

## Purpose

Every table, described in **business terms** first, then key columns. Source: `backend/database/init/2026-07-07-00-init-schema.sql` (38 tables). "Backend entity" notes whether a TypeORM entity exists for it today (see `docs/ai/CURRENT-STATE.md` for the full gap list).

## When to read

Before touching any table or writing a query.

## Keep updated

- When a table or column is added, changed, or removed.

## Exercise catalog (9 tables)

- **`exercises`** — a catalog exercise. `name`, `slug` (unique), `tracking_mode` (single/sets/interval/mixed), `is_active`. Backend entity: yes.
- **`exercise_categories`** — a category an exercise can belong to (e.g. "strength"). `code` (unique), `name`. Backend entity: yes.
- **`exercise_category_map`** — many-to-many exercise↔category, with `is_primary` (one primary per exercise, enforced by a partial unique index from a migration). Backend entity: yes.
- **`exercise_locations`** — where an exercise can be performed (e.g. "gym", "home"). Backend entity: yes.
- **`exercise_location_map`** — many-to-many exercise↔location, `is_primary` same pattern as above. Backend entity: yes.
- **`body_parts`** — self-referencing hierarchy of body parts (`parent_id`, `level`). Backend entity: yes.
- **`exercise_body_part_map`** — exercise↔body part, `relation_type` (primary/secondary/supporting), `priority_order`. Backend entity: yes.
- **`metric_types`** — a kind of measurable value (reps, weight, seconds...), `value_type` (int/decimal/text/seconds/boolean), `default_unit`. Backend entity: yes.
- **`exercise_metrics`** — which metrics apply/are required for an exercise. Backend entity: yes.

## Users (2 tables)

- **`users`** — an account: `username`/`email` (both unique), `password_hash`, `is_active`. UUID PK. Backend entity: yes.
- **`user_profiles`** — public profile: `display_name`, `bio`, `preferred_language`, `profile_image_url`, `is_private`. 1:1 with `users` (PK = FK). Backend entity: yes.

## Routines (5 tables) — planned exercises

- **`routines`** — a reusable set of exercises. `created_by_user_id` (nullable, `ON DELETE SET NULL`). Backend entity: yes.
- **`routine_exercises`** — an exercise placed in a routine, `order_index`. Backend entity: yes.
- **`routine_exercise_sets`** — a planned set within a routine exercise, `set_number`, `rest_seconds_after`. Backend entity: yes.
- **`routine_exercise_set_targets`** — the target metric value for a planned set (exactly one of `target_value_{int,decimal,text,seconds,boolean}` set — enforced by a `CHECK`). Backend entity: yes.
- **`routine_exercise_targets`** — same idea as above but for exercises that don't use sets (`tracking_mode != 'sets'`). Backend entity: yes.

## Challenges (4 tables)

- **`challenges`** — a fitness challenge. `visibility` (public/private), `duration_days`, `cycle_length_days`, `created_by_user_id` (nullable). UUID PK. Backend entity: yes.
- **`challenge_invites`** — an invitation to join a challenge. `status` (pending/accepted/declined/cancelled/expired), sender/recipient FKs to `users`, a partial unique index prevents duplicate active pending invites. Backend entity: **no**.
- **`challenge_user_map`** — a user's participation: `role` (owner/participant), `status` (active/completed/left). Backend entity: yes.
- **`challenge_cycle_days`** — one day in a challenge's repeating cycle: `day_in_cycle`, `day_type` (workout/rest), optional `routine_id`. Backend entity: yes.

## Workout logs (7 tables) — actuals

- **`workout_logs`** — a real workout session: `started_at`/`ended_at`, `status` (in_progress/completed/cancelled), optional links to `routine_id`/`challenge_id`/`challenge_cycle_day_id`. BIGINT PK. Backend entity: yes.
- **`workout_log_exercises`** — an exercise actually performed in a session, `order_index`, optional link back to the planning `routine_exercise_id`. Backend entity: yes.
- **`workout_log_exercise_targets`** — targets copied in at logging time for non-set exercises. Backend entity: yes.
- **`workout_log_exercise_metrics`** — the real recorded value for a non-set exercise (same one-of-five-value `CHECK` pattern). Backend entity: yes.
- **`workout_log_exercise_sets`** — a real set performed, `set_number`, `completed_at`. Backend entity: yes.
- **`workout_log_exercise_set_targets`** — target copied in per real set. Backend entity: yes.
- **`workout_log_exercise_set_metrics`** — the real recorded value per set. Backend entity: yes (`metrics/entities/workout-log-exercise-metric.entity.ts` — verify it covers both the exercise-level and set-level metric tables, or whether a second entity is needed).

## Social / feed (3 tables)

- **`user_follows`** — directed follower→followed relationship, `is_active`. Backend entity: **no**.
- **`workout_posts`** — the social/evidence post tied 1:1 to a `workout_log` (`workout_log_id` unique). `image_url`, `caption`, `visibility` (followers/private), plus `moderation_status`/`moderation_reason`/`moderated_at` from a migration (not in the base init file). Backend entity: yes.
- **`workout_post_likes`** — a like on a post. Backend entity: **no**.

## Spaces / group chat (3 tables)

- **`spaces`** — a community/group chat. `visibility` (public/private), `created_by_user_id` (`ON DELETE RESTRICT` — creator can't be deleted while the space exists). Backend entity: **no**.
- **`space_members`** — membership, `role` (owner/admin/member). Backend entity: **no**.
- **`space_messages`** — a message in a space. Backend entity: **no**.

## Direct messaging (3 tables)

- **`direct_conversations`** — a private conversation. Backend entity: **no**.
- **`direct_conversation_members`** — participants. Backend entity: **no**.
- **`direct_messages`** — a message, optionally referencing a `workout_post_id` (share-a-post-in-DM). Backend entity: **no**.

## Notifications (2 tables)

- **`notification_types`** — catalog of notification kinds. Backend entity: **no**.
- **`notifications`** — a unified notification inbox row: `recipient_user_id`, `actor_user_id` (nullable), `related_entity_type` enum, `is_read`. Backend entity: **no**.

> Keep descriptions business-focused. Must reflect the real current schema, not assumptions.
