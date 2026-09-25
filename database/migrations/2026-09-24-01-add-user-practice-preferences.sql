-- 2026-09-24-01-add-user-practice-preferences.sql
--
-- Part of the new onboarding flow: a "which sports/practices do you do" step
-- whose picks show as colored badges on the profile screen (Weightlifting,
-- Yoga, Boxing, ...). Plain text array, not a join table with a reference
-- table of its own — the valid codes/labels/activity-color mapping are
-- owned by the frontend (`constants/practiceOptions.ts`), the exact same
-- "small, frontend-defined list" pattern challenge categories/locations
-- already use. Capped at 6 selections, enforced in UpdateUserProfileDto, not
-- here.
--
-- Plain ADD COLUMN with a default, no lookups, no RAISE EXCEPTION path — the
-- deliberately simplest possible shape for an automatic-on-every-deploy
-- migration (see 2026-09-21-05's own incident: a migration that can fail
-- takes the whole backend down with it, not just the one feature).
--
-- Idempotent: IF NOT EXISTS, safe to re-run.

ALTER TABLE havit.user_profiles
  ADD COLUMN IF NOT EXISTS practice_preferences TEXT[] NOT NULL DEFAULT '{}';
