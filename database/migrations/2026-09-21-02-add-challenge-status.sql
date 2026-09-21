-- 2026-09-21-02-add-challenge-status.sql
--
-- Bloque 1: an admin can close a challenge ("no one will be able to join or
-- log new progress once it is closed"). `challenges` had no lifecycle status
-- at all before this (only `visibility`, which is public/private, not
-- open/closed) — the frontend's `ChallengeContract.status` field for this
-- was being read off a response that could never actually carry it.
--
-- A fresh enum (not reusing challenge_user_status_enum, which is a
-- PARTICIPANT's status in ONE challenge — 'active'/'completed'/'left' — a
-- different concept from the challenge's own lifecycle) so both values are
-- available immediately in this same migration/transaction; unlike
-- ALTER TYPE ... ADD VALUE on an existing enum (see
-- 2026-08-16-01-add-public-post-visibility.sql's own note), a type created
-- fresh has no "can't use it in the same transaction" restriction.
DO $$
BEGIN
  CREATE TYPE havit.challenge_status_enum AS ENUM ('open', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE havit.challenges
  ADD COLUMN IF NOT EXISTS status havit.challenge_status_enum NOT NULL DEFAULT 'open';
