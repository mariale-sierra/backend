-- 2026-10-06-02-add-challenges-is-active.sql
-- Sprint 9, B4: owner deletion of a challenge becomes a SOFT delete.
--
-- ChallengesService.remove() used to hard-delete the row, which cascaded
-- through challenge_user_map / challenge_join_requests / cycle days and
-- orphaned workout history. From now on it only flips is_active to false;
-- every read path treats an inactive challenge as nonexistent.
--
-- Deliberately a separate column from `status` ('open'/'closed', the
-- functional lifecycle an admin controls): "closed" challenges are still
-- visible, deleted ones are not. Every existing row stays active.

ALTER TABLE havit.challenges
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
