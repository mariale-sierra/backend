-- 2026-10-02-02-add-workout-logs-user-started-at-index.sql
--
-- B1 (escalabilidad): GET /workout-logs is being cursor-paginated
-- (src/common/pagination.util.ts, keyset over (started_at DESC, id DESC),
-- scoped by user_id — see WorkoutLogService.findAll()). The existing
-- idx_workout_logs_user_id (plain user_id) does not cover this sort order:
-- Postgres would still need a separate sort step after the index scan.

CREATE INDEX IF NOT EXISTS idx_workout_logs_user_started_at
  ON havit.workout_logs (user_id, started_at DESC, id DESC);
