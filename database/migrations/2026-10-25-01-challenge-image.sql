-- 2026-10-25-01-challenge-image.sql
-- Foto opcional del reto (portada en Explore y en la info del reto).
--
-- * challenges.image_url: subida propia a R2 del creador (assertOwnUploadUrl). NULL = sin foto.
-- * challenges.image_moderation_status: la foto nace 'pending' y la revisa ChallengesService
--   con la misma moderación de OpenAI que las fotos de progreso. Solo una foto 'approved'
--   se devuelve al cliente. NULL = sin foto.
-- * índice parcial para que el cron de moderación no escanee challenges completa.

ALTER TABLE havit.challenges
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE havit.challenges
  ADD COLUMN IF NOT EXISTS image_moderation_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'challenges_image_moderation_status_check'
  ) THEN
    ALTER TABLE havit.challenges
      ADD CONSTRAINT challenges_image_moderation_status_check
      CHECK (image_moderation_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_challenges_image_pending
  ON havit.challenges (created_at)
  WHERE image_moderation_status = 'pending';
