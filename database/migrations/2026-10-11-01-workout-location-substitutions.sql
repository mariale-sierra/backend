-- 2026-10-11-01-workout-location-substitutions.sql
-- Sprint 9, B7: dynamic locations + per-user exercise substitution.
--
-- A user can run a challenge routine from another location (Home/Gym/Outdoor)
-- and swap the exercises that do not fit it. The shared routine
-- (routine_exercises) and the challenge cycle day are NEVER touched: the swap
-- lives only in the user's own workout log, which already snapshots one
-- workout_log_exercises row per routine exercise.
--
--   workout_log_exercises.exercise_id           -> the EFFECTIVE exercise done
--   workout_log_exercises.original_exercise_id  -> what the routine prescribed
--                                                  (NULL = not substituted)
--   workout_logs.location_id                    -> location the user trained at
--
-- Both columns are nullable and additive, so existing rows keep working.

ALTER TABLE havit.workout_log_exercises
  ADD COLUMN IF NOT EXISTS original_exercise_id BIGINT;

ALTER TABLE havit.workout_logs
  ADD COLUMN IF NOT EXISTS location_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_workout_log_exercises_original_exercise'
  ) THEN
    ALTER TABLE havit.workout_log_exercises
      ADD CONSTRAINT fk_workout_log_exercises_original_exercise
      FOREIGN KEY (original_exercise_id) REFERENCES havit.exercises(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_workout_logs_location'
  ) THEN
    ALTER TABLE havit.workout_logs
      ADD CONSTRAINT fk_workout_logs_location
      FOREIGN KEY (location_id) REFERENCES havit.exercise_locations(id)
      ON DELETE SET NULL;
  END IF;
END $$;
