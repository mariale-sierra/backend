-- 2026-08-02-02-backfill-workout-log-status.sql
-- createWorkout (backend/src/workout-log/workout-log.service.ts) always set
-- new logs to 'in_progress' and nothing ever called PATCH /workout-logs/:id/finish
-- to move them to 'completed' — every workout log ever created is stuck
-- 'in_progress', which is exactly what progress_percent/streak filter on.
-- That code path is now fixed to create logs as 'completed' directly; this
-- backfills the logs that already exist so existing progress/streaks show
-- up immediately instead of only for logs created after this deploy.
UPDATE havit.workout_logs
SET status = 'completed', ended_at = COALESCE(ended_at, started_at)
WHERE status = 'in_progress';
