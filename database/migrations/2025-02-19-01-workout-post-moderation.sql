-- 2025-02-19-01-workout-post-moderation.sql
-- Adds moderation fields to workout_posts (OpenAI content moderation flow).
-- Ported from the legacy TypeORM migration
-- backend/src/migrations/workout-post-moderation.migration.ts (frozen, kept for history).
-- Not present in database/init, so this must run as a real migration.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'workout_posts_moderation_status_enum' AND n.nspname = 'havit'
  ) THEN
    CREATE TYPE havit.workout_posts_moderation_status_enum AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

ALTER TABLE havit.workout_posts
  ADD COLUMN IF NOT EXISTS moderation_status havit.workout_posts_moderation_status_enum NOT NULL DEFAULT 'pending';

ALTER TABLE havit.workout_posts
  ADD COLUMN IF NOT EXISTS moderation_reason TEXT;

ALTER TABLE havit.workout_posts
  ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMP;
