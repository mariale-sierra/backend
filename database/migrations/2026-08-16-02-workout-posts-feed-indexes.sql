-- 2026-08-16-02-workout-posts-feed-indexes.sql
-- B2 Posts/Feed: indexes for the two new read paths added in this module.
--
-- Must run after 2026-08-16-01-add-public-post-visibility.sql (separate
-- migration files run in separate transactions in filename order, so the
-- 'public' enum value from that file is already committed and usable here).
--
-- idx_workout_posts_public_feed: supports GET /feed and the "posts of
-- another user" branch of GET /workout-posts/user/:userId
--   WHERE visibility = 'public' AND moderation_status = 'approved'
--   ORDER BY created_at DESC, id DESC
-- Both callers require this exact pair unconditionally (no query in this
-- codebase ever asks for visibility='public' with a moderation_status other
-- than 'approved'), so the equality on moderation_status is baked into the
-- partial predicate rather than kept as a leading index column — a tighter,
-- smaller index than (moderation_status, created_at, id) WHERE visibility=
-- 'public' would be, with identical query coverage for every real caller.
CREATE INDEX IF NOT EXISTS idx_workout_posts_public_feed
  ON havit.workout_posts (created_at DESC, id DESC)
  WHERE visibility = 'public' AND moderation_status = 'approved';

-- idx_workout_posts_user_timeline: supports GET /workout-posts/mine and
-- GET /workout-posts/user/:userId (both the "viewing myself" and "viewing
-- another user" cases), which always filter by user_id first regardless of
-- visibility/moderation.
CREATE INDEX IF NOT EXISTS idx_workout_posts_user_timeline
  ON havit.workout_posts (user_id, created_at DESC, id DESC);
