-- 2026-10-07-02-create-hashtags.sql
-- Sprint 10, B5: #hashtags on workout posts.
--
-- Relational (not a text/array column on workout_posts) so a future
-- search / "posts with #tag" grouping is a plain indexed join:
--   hashtags            one row per distinct tag, stored lowercase without '#'
--   workout_post_hashtags  many-to-many post <-> tag
-- Tags are parsed from the caption by the backend when a post is created
-- (WorkoutPostsService.create); nothing writes these tables directly.

CREATE TABLE IF NOT EXISTS havit.hashtags (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tag VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_hashtags_tag UNIQUE (tag),
  CONSTRAINT chk_hashtags_tag_lowercase CHECK (tag = lower(tag))
);

CREATE TABLE IF NOT EXISTS havit.workout_post_hashtags (
  workout_post_id UUID NOT NULL,
  hashtag_id BIGINT NOT NULL,
  PRIMARY KEY (workout_post_id, hashtag_id),
  CONSTRAINT fk_workout_post_hashtags_post
    FOREIGN KEY (workout_post_id) REFERENCES havit.workout_posts(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_workout_post_hashtags_hashtag
    FOREIGN KEY (hashtag_id) REFERENCES havit.hashtags(id)
    ON DELETE CASCADE
);

-- "Posts with this tag" (future search/grouping) walks from the tag side.
CREATE INDEX IF NOT EXISTS idx_workout_post_hashtags_hashtag
  ON havit.workout_post_hashtags (hashtag_id);

-- Backfill: tag the captions that already exist, with the same rules as
-- extractHashtags() (src/workout-posts/hashtags/hashtag.util.ts) — a '#' not
-- glued to a preceding word, letters/digits/underscore, lowercase, max 50
-- chars, not only digits, at most 10 distinct tags per post. Idempotent
-- (ON CONFLICT DO NOTHING on both inserts).
WITH matches AS (
  SELECT p.id AS workout_post_id,
         lower(m[2]) AS tag,
         ord
  FROM havit.workout_posts p
  CROSS JOIN LATERAL regexp_matches(
    p.caption, '(^|[^[:alnum:]_&#])#([[:alnum:]_]+)', 'g'
  ) WITH ORDINALITY AS r(m, ord)
  WHERE p.caption IS NOT NULL
),
distinct_tags AS (
  SELECT workout_post_id, tag, MIN(ord) AS first_ord
  FROM matches
  WHERE char_length(tag) <= 50 AND tag !~ '^[0-9]+$'
  GROUP BY workout_post_id, tag
),
capped AS (
  SELECT workout_post_id, tag
  FROM (
    SELECT workout_post_id, tag,
           ROW_NUMBER() OVER (PARTITION BY workout_post_id ORDER BY first_ord) AS rn
    FROM distinct_tags
  ) ranked
  WHERE rn <= 10
),
inserted_tags AS (
  INSERT INTO havit.hashtags (tag)
  SELECT DISTINCT tag FROM capped
  ON CONFLICT (tag) DO NOTHING
  RETURNING id, tag
)
INSERT INTO havit.workout_post_hashtags (workout_post_id, hashtag_id)
SELECT c.workout_post_id, h.id
FROM capped c
JOIN (
  SELECT id, tag FROM inserted_tags
  UNION
  SELECT id, tag FROM havit.hashtags
) h ON h.tag = c.tag
ON CONFLICT DO NOTHING;
