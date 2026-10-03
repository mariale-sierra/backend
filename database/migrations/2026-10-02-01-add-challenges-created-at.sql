-- 2026-10-02-01-add-challenges-created-at.sql
--
-- B1 (escalabilidad): GET /challenges is being cursor-paginated the same way
-- GET /workout-posts/user/:userId already is (src/common/pagination.util.ts:
-- keyset pagination over (created_at DESC, id DESC)). `challenges` had no
-- timestamp column at all — its UUID primary key is not chronologically
-- ordered, so it cannot back a "most recent first" cursor on its own.
--
-- DEFAULT now() backfills every existing row at migration time (no separate
-- backfill script needed) with "whenever this migration ran" — acceptable
-- here since there is no real creation timestamp to recover for pre-existing
-- rows, and this only affects relative ordering among those pre-existing
-- rows, not any new one going forward.

ALTER TABLE havit.challenges
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backs the new (created_at DESC, id DESC) keyset ordering ChallengesService.
-- findAll() now uses — see src/challenges/challenges.service.ts.
CREATE INDEX IF NOT EXISTS idx_challenges_created_at
  ON havit.challenges (created_at DESC, id DESC);
