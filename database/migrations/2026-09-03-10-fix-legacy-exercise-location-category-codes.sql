-- 2026-09-03-10-fix-legacy-exercise-location-category-codes.sql
-- Fixes a pre-existing bug: earlier seeds (2026-08-28-01, 2026-08-29-01) used hyphenated
-- category codes ('cardio-intense') that don't match the real underscore codes
-- ('cardio_intense'), and referenced location codes ('cualquier-lugar', 'home-outdoor') never
-- actually inserted by any versioned file — silently dropping tags on a from-scratch DB build
-- (9 exercises end up uncategorized, 2 unlocated). Confirmed empirically against a fresh local
-- Postgres this session.
--
-- IMPORTANT: locations stay EXACTLY 5 (gym/home/outdoor/studio/anywhere) after this file runs,
-- on every environment. 'cualquier-lugar' is not a 6th location — production's real 5th-slot
-- row has historically been coded 'cualquier-lugar' instead of 'anywhere' (hand-seeded before
-- this migration system existed); this file renames it IN PLACE (same id, so existing
-- exercise_location_map rows keep resolving correctly, zero data migration needed for the map
-- table). 'home-outdoor' is not a location either — if that row physically exists (same
-- hand-seeding history), this file decomposes every reference to it into two separate relations
-- (home + outdoor) and then deletes the row. All idempotent / safe to re-run.

-- 1. Category code drift: real DB uses underscore codes, some seeds assumed hyphenated ones.
INSERT INTO havit.exercise_category_map (exercise_id, category_id, is_primary)
SELECT e.id, ec.id, true
FROM (VALUES
  ('rowing-intervals', 'cardio_intense'),
  ('stair-climber-intervals', 'cardio_intense'),
  ('hiit-circuit', 'cardio_intense'),
  ('recovery-walk', 'cardio_low'),
  ('low-impact-cardio-class', 'cardio_low'),
  ('easy-jog', 'cardio_low'),
  ('meditation-session', 'mind_body'),
  ('tai-chi', 'mind_body'),
  ('mindful-cooldown', 'mind_body')
) AS mapping(exercise_slug, category_code)
JOIN havit.exercises e ON e.slug = mapping.exercise_slug
JOIN havit.exercise_categories ec ON ec.code = mapping.category_code
ON CONFLICT (exercise_id, category_id) DO UPDATE SET is_primary = true;

-- 2. Normalize the legacy 'cualquier-lugar' location code to the canonical 'anywhere' —
--    rename in place, never insert a new row.
UPDATE havit.exercise_locations SET code = 'anywhere', name = 'Anywhere' WHERE code = 'cualquier-lugar';

-- 3. If a legacy 'home-outdoor' location row physically exists, decompose every reference to it
--    into home + outdoor, then remove the row entirely. No-op on a fresh DB (row never existed).
DO $$
DECLARE
  v_home_outdoor_id BIGINT;
  v_home_id BIGINT;
  v_outdoor_id BIGINT;
BEGIN
  SELECT id INTO v_home_outdoor_id FROM havit.exercise_locations WHERE code = 'home-outdoor';
  IF v_home_outdoor_id IS NOT NULL THEN
    SELECT id INTO v_home_id FROM havit.exercise_locations WHERE code = 'home';
    SELECT id INTO v_outdoor_id FROM havit.exercise_locations WHERE code = 'outdoor';

    INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary, source, mapping_reason)
    SELECT exercise_id, v_home_id, is_primary, source, 'split from legacy home-outdoor'
    FROM havit.exercise_location_map WHERE location_id = v_home_outdoor_id
    ON CONFLICT (exercise_id, location_id) DO NOTHING;

    INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary, source, mapping_reason)
    SELECT exercise_id, v_outdoor_id, is_primary, source, 'split from legacy home-outdoor'
    FROM havit.exercise_location_map WHERE location_id = v_home_outdoor_id
    ON CONFLICT (exercise_id, location_id) DO NOTHING;

    DELETE FROM havit.exercise_location_map WHERE location_id = v_home_outdoor_id;
    DELETE FROM havit.exercise_locations WHERE id = v_home_outdoor_id;
  END IF;
END $$;

-- 4. Ensure the two affected exercises have the correct location tag even on a fresh DB, where
--    the legacy rows above never existed as such (steps 2-3 were no-ops there) — using only the
--    5 canonical location codes.
INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary, source)
SELECT e.id, el.id, true, 'manual_override'
FROM havit.exercises e, havit.exercise_locations el
WHERE e.slug = 'easy-jog' AND el.code = 'anywhere'
ON CONFLICT (exercise_id, location_id) DO NOTHING;

INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary, source)
SELECT e.id, el.id, (el.code = 'home'), 'manual_override'
FROM havit.exercises e, havit.exercise_locations el
WHERE e.slug = 'tai-chi' AND el.code IN ('home', 'outdoor')
ON CONFLICT (exercise_id, location_id) DO NOTHING;
