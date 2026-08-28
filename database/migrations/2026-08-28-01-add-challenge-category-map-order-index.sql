-- 2026-08-28-01-add-challenge-category-map-order-index.sql
-- challenge_category_map has no column preserving the order the user picked
-- categories in at challenge creation (ChallengesService.linkChallengeCategories
-- inserts rows sequentially in that order, but a plain SELECT was never
-- guaranteed to come back in insertion order). Needed as the tie-break for
-- "Activity Color System v2"'s dominant_activity_category: when two categories
-- are tied for most exercises, the one the creator picked first wins.
-- Existing rows get order_index 0 (no meaningful order to backfill — the
-- tie-break only needs to be correct going forward).

ALTER TABLE havit.challenge_category_map
  ADD COLUMN IF NOT EXISTS order_index SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN havit.challenge_category_map.order_index IS 'Position (0-based) in which the user picked this category at challenge creation — tie-break order for dominant_activity_category. Pre-existing rows default to 0 (no meaningful order).';
