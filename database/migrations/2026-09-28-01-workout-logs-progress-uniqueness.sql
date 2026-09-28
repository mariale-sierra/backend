-- 2026-09-28-01-workout-logs-progress-uniqueness.sql
--
-- B5 (concurrency/integrity of Workout Progress): closes the check-then-insert
-- race in WorkoutLogService.createWorkout() — two overlapping
-- POST /workout-logs/progress requests could both pass the pre-check SELECT
-- (neither sees the other's row yet) and both INSERT, producing two
-- workout_logs rows for what the product treats as a single day's progress.
-- Application-level "check if it exists, then insert" is not sufficient on
-- its own; this adds the actual authority at the database level.
--
-- Uniqueness identity determined from the current domain model (see
-- WorkoutLogService.createWorkout, src/common/timezone.util.ts):
--   (user_id, challenge_id, local_day)
--
-- Why not the other candidates:
--   * user + challenge + routine_id -- routine is incidental to a day's log.
--     Nothing in the existing duplicate-check (or anywhere else) treats
--     switching routines as making a second same-day log legitimate, and
--     routine_id is nullable/optional on this very endpoint.
--   * user + challenge + challenge_cycle_day_id -- workout_logs.challenge_cycle_day_id
--     is a real FK column (-> challenge_cycle_days) but nothing in the
--     current application code ever populates it (confirmed by repo-wide
--     search); it can't be the identity basis while it's always NULL.
--   * A raw expression index on started_at (e.g. date_trunc) -- would bake a
--     SERVER-side timezone interpretation into the constraint, but "day" is
--     already a per-request concept here (the caller's X-Timezone header,
--     see resolveRequestTimezone/getLocalDayBoundsUtc), not a fixed offset.
--     Computing local_day once in application code, at write time, with the
--     exact same helper the existing pre-check already uses, keeps the DB
--     constraint in agreement with app semantics instead of introducing a
--     second, potentially divergent, timezone conversion inside Postgres.
--
-- local_day is populated going forward by WorkoutLogService.createWorkout
-- (only when challengeId is set -- the plain POST /workout-logs path has no
-- per-day gate and leaves it NULL, same as it leaves challenge_id NULL).

ALTER TABLE havit.workout_logs
  ADD COLUMN IF NOT EXISTS local_day DATE;

-- Backfill for pre-existing challenge rows. Historical per-request timezone
-- headers were never persisted, so the exact local day the app would have
-- computed at the time can't be reconstructed; started_at's own calendar
-- date is the closest available proxy, and is exact whenever the request
-- timezone was UTC (the default) or the app/DB server's own pinned UTC clock
-- (see src/set-timezone.ts) put started_at at the same calendar date UTC and
-- the user's local zone would have. This only fills rows that would
-- otherwise block the constraint below; it never touches started_at or any
-- other column.
UPDATE havit.workout_logs
SET local_day = started_at::date
WHERE challenge_id IS NOT NULL
  AND local_day IS NULL;

-- Fail loudly and specifically, instead of leaving a bare Postgres
-- "duplicate key value violates unique constraint" to explain itself, if
-- real duplicate progress rows already exist under this identity (e.g. from
-- the very race this migration closes, or from the backfill above landing
-- two historical rows on the same reconstructed day). Per B5 policy: never
-- silently delete/merge shared Azure data -- this only reports the conflict
-- so it can be resolved deliberately, and leaves every row untouched
-- (the whole file rolls back atomically on this exception, per this
-- project's migration runner).
DO $$
DECLARE
  dupe_count INT;
BEGIN
  SELECT COUNT(*) INTO dupe_count FROM (
    SELECT user_id, challenge_id, local_day
    FROM havit.workout_logs
    WHERE challenge_id IS NOT NULL
    GROUP BY user_id, challenge_id, local_day
    HAVING COUNT(*) > 1
  ) dupes;

  IF dupe_count > 0 THEN
    RAISE EXCEPTION
      'B5: % (user_id, challenge_id, local_day) group(s) already have more than one workout_logs row -- resolve manually before this migration can apply the unique index. Inspect with: SELECT user_id, challenge_id, local_day, COUNT(*), array_agg(id ORDER BY id) AS workout_log_ids FROM havit.workout_logs WHERE challenge_id IS NOT NULL GROUP BY user_id, challenge_id, local_day HAVING COUNT(*) > 1 ORDER BY 1, 2, 3;',
      dupe_count;
  END IF;
END $$;

-- The actual authority: partial (challenge rows only) unique index. A
-- concurrent second INSERT for the same (user_id, challenge_id, local_day)
-- now fails at the database with a 23505 duplicate-key error regardless of
-- what either transaction's own pre-check SELECT saw -- WorkoutLogService
-- catches that error and returns the same 409 Conflict ("You already logged
-- progress today") the sequential pre-check already gave, so both a
-- sequential duplicate and a genuine race behave identically to the client.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workout_logs_user_challenge_local_day
  ON havit.workout_logs (user_id, challenge_id, local_day)
  WHERE challenge_id IS NOT NULL;
