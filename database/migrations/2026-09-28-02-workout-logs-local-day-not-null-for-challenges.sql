-- 2026-09-28-02-workout-logs-local-day-not-null-for-challenges.sql
--
-- B5 follow-up: uq_workout_logs_user_challenge_local_day
-- (2026-09-28-01-workout-logs-progress-uniqueness.sql) is a partial unique
-- index on (user_id, challenge_id, local_day) WHERE challenge_id IS NOT
-- NULL. PostgreSQL unique indexes treat NULL as distinct from every other
-- NULL, so if a challenge workout_logs row were ever inserted with
-- local_day left NULL, it would sail straight through that index with NO
-- protection at all -- silently reopening the exact race B5 closes, for
-- that row's (user_id, challenge_id) pair, with no error and no signal.
--
-- The current write path (WorkoutLogService.createWorkout) always computes
-- local_day before entering the transaction whenever challengeId is set --
-- confirmed it's the only code path in this codebase that inserts into
-- workout_logs. But that's an invariant of today's application code, not
-- of the database: nothing stops a future endpoint, refactor, or admin
-- script from inserting a challenge row without setting local_day. This
-- CHECK constraint makes that impossible at the database level, matching
-- the same "database must be the final authority" principle the unique
-- index itself was added for.
--
-- Safe to add now: 2026-09-28-01's backfill already guarantees every
-- existing challenge_id IS NOT NULL row has local_day IS NOT NULL (it's
-- derived from started_at, itself NOT NULL) before this file ever runs
-- (migrations apply in filename order). If that invariant were somehow
-- violated in the meantime, see the deploy-safety note right above the
-- DO blocks below.
--
-- (Historical-data note, carried over from 2026-09-28-01: local_day for
-- rows logged before this feature existed was backfilled from
-- started_at::date -- a UTC calendar day, since the original per-request
-- X-Timezone header was never persisted. A workout logged close to local
-- midnight in a non-UTC timezone may therefore have been backfilled onto a
-- different calendar day than the app itself would have assigned live at
-- submission time. That's a one-time limit of reconstructing old data with
-- no timezone on record, not a defect in the ongoing invariant this file
-- adds: every row written by the current code has local_day computed
-- through the same live per-request timezone logic as the rest of the
-- day-boundary checks, with no reconstruction involved.)
-- Deploy-safety (same precedent as the flexibility-migration hotfix: a
-- migration must never crash the deploy): the constraint is added NOT VALID
-- first, so it is enforced for every new/updated row immediately regardless
-- of history; VALIDATE then checks the existing rows. If some legacy row
-- violated it, the validation failure is downgraded to a WARNING instead of
-- aborting `npm start` -- the constraint stays in place (NOT VALID) and the
-- warning tells whoever reads the deploy log to clean that row up and
-- re-run `ALTER TABLE havit.workout_logs VALIDATE CONSTRAINT ...` by hand.
DO $$
BEGIN
  ALTER TABLE havit.workout_logs
    ADD CONSTRAINT ck_workout_logs_challenge_requires_local_day
    CHECK (challenge_id IS NULL OR local_day IS NOT NULL) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE havit.workout_logs
    VALIDATE CONSTRAINT ck_workout_logs_challenge_requires_local_day;
EXCEPTION
  WHEN check_violation THEN
    RAISE WARNING 'ck_workout_logs_challenge_requires_local_day left NOT VALID: legacy rows with challenge_id but no local_day exist';
END $$;
