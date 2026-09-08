-- 2026-09-08-01-create-workout-post-comments.sql
-- Comments on workout posts (Sprint 8, Bloque 3 — Reacciones y comentarios).
-- Reactions reuse the existing havit.workout_post_likes table from the init
-- schema (already the exact model needed: composite PK enforces one 'like'
-- per user per post, no separate reaction-type column). Comments have no
-- equivalent table yet, so this creates one. Mirrors space_messages'
-- shape/conventions (BIGINT identity PK, soft delete via is_active) — same
-- pattern already used for workout_posts and user_follows themselves.

CREATE TABLE IF NOT EXISTS havit.workout_post_comments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workout_post_id UUID NOT NULL,
  user_id UUID NOT NULL,
  comment_text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_workout_post_comments_post
    FOREIGN KEY (workout_post_id) REFERENCES havit.workout_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_workout_post_comments_user
    FOREIGN KEY (user_id) REFERENCES havit.users (id) ON DELETE CASCADE
);
COMMENT ON TABLE havit.workout_post_comments IS 'Comentarios de un workout_post (Bloque 3).';

-- Backs "list comments for a post, oldest first, keyset-paginated by id" —
-- same (parent_id, id) index shape as idx_space_messages_space_id_id.
CREATE INDEX IF NOT EXISTS idx_workout_post_comments_post_id_id
  ON havit.workout_post_comments (workout_post_id, id);
