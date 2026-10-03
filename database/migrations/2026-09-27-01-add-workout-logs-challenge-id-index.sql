-- 2026-09-27-01-add-workout-logs-challenge-id-index.sql
--
-- B6 (performance): `workout_logs` already has btree indexes on `user_id` and
-- `routine_id`, but not on `challenge_id`, even though it's a real FK
-- (`fk_workout_logs_challenge`) and is filtered on directly by
-- WorkoutPostsService.findMosaicByChallenge() (GET /workout-posts/mosaic)
-- via `workoutLog.challenge_id = :challengeId`.
--
-- Evidence (local benchmark DB, 20k workout_logs / ~7k workout_posts):
--   EXPLAIN (ANALYZE, BUFFERS) on the mosaic join showed a full Seq Scan on
--   workout_logs (20000 rows scanned, 19760 removed by the challenge_id
--   filter) feeding a Hash Join against a second full Seq Scan on
--   workout_posts — see backend/performance/results/before/explain-mosaic-before.txt.
--   That cost grows linearly with total workout_logs across every
--   challenge, not with the one challenge being queried.
--
-- Not touched: WorkoutLogService/ChallengesService's per-user "today"/
-- "completed days" lookups already filter through `idx_workout_logs_user_id`
-- first (a user's own workout count stays small), confirmed cheap via
-- EXPLAIN — no evidence they need this index too, so it's scoped to
-- challenge_id only.

CREATE INDEX IF NOT EXISTS idx_workout_logs_challenge_id
  ON havit.workout_logs (challenge_id);
