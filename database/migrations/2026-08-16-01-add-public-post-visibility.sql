-- 2026-08-16-01-add-public-post-visibility.sql
-- B2 Posts/Feed: adds 'public' as a third value of havit.post_visibility_enum
-- (previously only 'followers' | 'private'), so workout_posts can be marked
-- fully public instead of only "followers-visible" or private.
--
-- Purely additive: no existing row's visibility value changes, no backfill.
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that
-- inserts/selects rows using the new value, so this migration only adds the
-- enum value and does nothing else.

ALTER TYPE havit.post_visibility_enum ADD VALUE IF NOT EXISTS 'public';
