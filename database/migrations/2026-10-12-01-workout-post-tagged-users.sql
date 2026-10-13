-- 2026-10-12-01-workout-post-tagged-users.sql
-- Sprint 9, B8 (BUG-03): joint posts. The challenge owner can tag other
-- active participants of the challenge in their progress post; the app has
-- been sending taggedUserIds for that, but the table it needs only ever
-- existed on the unmerged feature/challenge-roles branch.
--
-- Same shape as that branch's table (and as workout_post_likes): composite
-- PK, so a user is tagged at most once per post, and no status column —
-- tagging needs no confirmation from the tagged user (product decision).
-- IF NOT EXISTS keeps this safe on a database where that branch's migration
-- was ever applied.

CREATE TABLE IF NOT EXISTS havit.workout_post_tagged_users (
  workout_post_id UUID NOT NULL,
  user_id UUID NOT NULL,
  tagged_by_user_id UUID NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workout_post_id, user_id),
  CONSTRAINT fk_workout_post_tagged_users_post
    FOREIGN KEY (workout_post_id) REFERENCES havit.workout_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_workout_post_tagged_users_user
    FOREIGN KEY (user_id) REFERENCES havit.users (id) ON DELETE CASCADE,
  CONSTRAINT fk_workout_post_tagged_users_tagged_by
    FOREIGN KEY (tagged_by_user_id) REFERENCES havit.users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workout_post_tagged_users_user_id
  ON havit.workout_post_tagged_users (user_id);

COMMENT ON TABLE havit.workout_post_tagged_users IS 'Participantes etiquetados por el dueño del challenge en un post conjunto. Sin confirmación del etiquetado (decisión de producto).';
