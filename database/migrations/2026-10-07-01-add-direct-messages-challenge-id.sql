-- 2026-10-07-01-add-direct-messages-challenge-id.sql
-- Sprint 10, B5: share a challenge inside a 1:1 conversation.
--
-- Mirrors the pre-existing direct_messages.workout_post_id (init schema),
-- which shares a workout post: a message may carry ONE optional reference to
-- shared content next to its text. ON DELETE SET NULL, same as
-- workout_post_id, so deleting a challenge never deletes chat history — the
-- message just renders as "content no longer available".

ALTER TABLE havit.direct_messages
  ADD COLUMN IF NOT EXISTS challenge_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_direct_messages_challenge'
  ) THEN
    ALTER TABLE havit.direct_messages
      ADD CONSTRAINT fk_direct_messages_challenge
      FOREIGN KEY (challenge_id) REFERENCES havit.challenges(id)
      ON DELETE SET NULL;
  END IF;
END $$;
