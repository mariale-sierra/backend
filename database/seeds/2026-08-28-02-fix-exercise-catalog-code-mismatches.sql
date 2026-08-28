-- 2026-08-28-02-fix-exercise-catalog-code-mismatches.sql
-- Follow-up to 2026-08-28-01-expand-exercise-catalog.sql. That seed assumed
-- exercise_categories/exercise_locations used the codes from
-- 2026-07-17-01-seed-exercise-categories-locations-metrics.sql
-- ('cardio_intense', 'cardio_low', 'mind_body', 'anywhere'). Discovered on
-- deploy (after fixing a separate, unrelated issue where db:migrate had
-- never actually been running on this deployment at all — see the
-- raiz repo's docker-compose.yml history) that this DB's real catalog was
-- seeded independently, by hand, before that seed file existed, using
-- different code strings for the same categories/locations:
--   exercise_categories: 'cardio-intense', 'cardio-low', 'mind-body'
--     (hyphens, not underscores — 'strength'/'flexibility'/'functional'
--     happen to be single words so they matched fine either way)
--   exercise_locations: 'cualquier-lugar' (not 'anywhere') for the
--     "any location" entry — 'gym'/'outdoor'/'studio'/'home' matched fine
-- Nothing was actually missing from the catalog, so this isn't adding rows
-- to exercise_categories/exercise_locations — it's re-pointing the specific
-- exercise tags that silently matched zero rows the first time (a JOIN
-- against a non-existent code just produces no output row, not an error).
--
-- Idempotent: safe to re-run, and a no-op if 2026-08-28-01 is ever fixed and
-- re-applied cleanly on a future fresh database using the real codes directly.

-- 1. Recategorize 'running' to Cardio Intense (real code, not
--    'cardio_intense'). Same no-op-if-missing guard as the original attempt.
DO $$
DECLARE
  v_running_id INT;
  v_cardio_intense_id INT;
  v_updated INT;
BEGIN
  SELECT id INTO v_running_id FROM havit.exercises WHERE slug = 'running';
  SELECT id INTO v_cardio_intense_id FROM havit.exercise_categories WHERE code = 'cardio-intense';

  IF v_running_id IS NULL OR v_cardio_intense_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE havit.exercise_category_map
  SET category_id = v_cardio_intense_id
  WHERE exercise_id = v_running_id AND is_primary = true;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    INSERT INTO havit.exercise_category_map (exercise_id, category_id, is_primary)
    VALUES (v_running_id, v_cardio_intense_id, true)
    ON CONFLICT (exercise_id, category_id) DO UPDATE SET is_primary = true;
  END IF;
END $$;

-- 2. Missing category tags for the 6 newly-seeded exercises whose category
--    code didn't match (cardio-intense/cardio-low/mind-body).
INSERT INTO havit.exercise_category_map (exercise_id, category_id, is_primary)
SELECT e.id, ec.id, true
FROM (VALUES
  ('sprint-intervals', 'cardio-intense'),
  ('jump-rope-hiit', 'cardio-intense'),
  ('brisk-walk', 'cardio-low'),
  ('zone-2-bike-ride', 'cardio-low'),
  ('guided-breathwork', 'mind-body'),
  ('restorative-yoga-flow', 'mind-body')
) AS mapping(exercise_slug, category_code)
JOIN havit.exercises e ON e.slug = mapping.exercise_slug
JOIN havit.exercise_categories ec ON ec.code = mapping.category_code
ON CONFLICT (exercise_id, category_id) DO UPDATE SET is_primary = true;

-- 3. Missing location tags for the 4 newly-seeded exercises that wanted
--    "anywhere" (real code 'cualquier-lugar').
INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary)
SELECT e.id, el.id, true
FROM (VALUES
  ('jump-rope-hiit', 'cualquier-lugar'),
  ('standing-hamstring-stretch', 'cualquier-lugar'),
  ('hip-flexor-stretch', 'cualquier-lugar'),
  ('guided-breathwork', 'cualquier-lugar')
) AS mapping(exercise_slug, location_code)
JOIN havit.exercises e ON e.slug = mapping.exercise_slug
JOIN havit.exercise_locations el ON el.code = mapping.location_code
ON CONFLICT (exercise_id, location_id) DO UPDATE SET is_primary = true;
