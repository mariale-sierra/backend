-- 2026-09-03-10-fix-legacy-exercise-location-category-codes.sql
-- Fixes a pre-existing bug: earlier seeds (2026-08-28-01, 2026-08-29-01) used hyphenated
-- category codes ('cardio-intense') that don't match the real underscore codes
-- ('cardio_intense'), and referenced location codes ('cualquier-lugar', 'home-outdoor') never
-- actually inserted by any versioned file — silently dropping tags on a from-scratch DB build
-- (9 exercises end up uncategorized, 2 unlocated). Confirmed empirically against a fresh local
-- Postgres this session.
--
-- IMPORTANT: locations stay EXACTLY 5 (gym/home/outdoor/studio/anywhere) after this file runs,
-- on every environment. 'home-outdoor' is not a location either — if that row physically
-- exists (hand-seeding history), this file decomposes every reference to it into two separate
-- relations (home + outdoor) and then deletes the row. All idempotent / safe to re-run.
--
-- 'cualquier-lugar' was assumed to be a simple rename-in-place onto 'anywhere' (this migration's
-- first version), but that failed live on 2026-09-03: production already had BOTH rows —
-- 'cualquier-lugar' (16 exercise_location_map rows, the legacy hand-seeded catalog) and a
-- separate 'anywhere' row (4 rows, from the RepDB import path) — a real duplicate, not a rename
-- target that's free. Step 2 below merges them the same way step 3 already merges
-- 'home-outdoor': re-point every exercise_location_map row onto the survivor, ON CONFLICT DO
-- NOTHING for an exercise already tagged with both, then delete the emptied row. Kept 'anywhere'
-- as the survivor (not 'cualquier-lugar') since that's the code every other lookup in this
-- codebase uses. Falls back to a plain rename when only one of the two rows exists (a fresh DB,
-- or an environment where this has already run).

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

-- 2. Merge the legacy 'cualquier-lugar' location into the canonical 'anywhere' one (see the
--    header note above for why this isn't a plain rename).
--
--    Failed live AGAIN on 2026-09-03 (this migration's third version), even after fixing the
--    'anywhere' target to merge instead of blindly rename: this block inserted the new
--    'anywhere' row BEFORE deleting the old 'cualquier-lugar' row. uq_exercise_location_primary
--    is checked immediately per statement, not deferred to end of transaction — so for any of
--    the 16 exercises whose cualquier-lugar row was primary, inserting a new is_primary=true row
--    at 'anywhere' while that OLD primary row still existed violated the constraint immediately,
--    regardless of whether the (exercise_id, location_id) conflict would separately have been
--    caught by ON CONFLICT. Now deletes the source rows FIRST (staged via a CTE), then
--    upserts into 'anywhere' with is_primary = old OR already-there — preserving true from
--    either side for the 4 exercises (confirmed live) that already had both rows, one of them
--    (cualquier-lugar) primary and the other (anywhere) not.
DO $$
DECLARE
  v_cualquier_lugar_id BIGINT;
  v_anywhere_id BIGINT;
BEGIN
  SELECT id INTO v_cualquier_lugar_id FROM havit.exercise_locations WHERE code = 'cualquier-lugar';
  SELECT id INTO v_anywhere_id FROM havit.exercise_locations WHERE code = 'anywhere';

  IF v_cualquier_lugar_id IS NOT NULL AND v_anywhere_id IS NOT NULL THEN
    WITH deleted_rows AS (
      DELETE FROM havit.exercise_location_map
      WHERE location_id = v_cualquier_lugar_id
      RETURNING exercise_id, is_primary, source
    )
    INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary, source, mapping_reason)
    SELECT exercise_id, v_anywhere_id, is_primary, source, 'merged from legacy cualquier-lugar'
    FROM deleted_rows
    ON CONFLICT (exercise_id, location_id) DO UPDATE
      SET is_primary = havit.exercise_location_map.is_primary OR EXCLUDED.is_primary;

    DELETE FROM havit.exercise_locations WHERE id = v_cualquier_lugar_id;
  ELSIF v_cualquier_lugar_id IS NOT NULL THEN
    -- No separate 'anywhere' row exists (fresh DB, or an environment where this already
    -- ran) — safe to rename in place, same id, zero data migration needed for the map table.
    UPDATE havit.exercise_locations SET code = 'anywhere', name = 'Anywhere'
    WHERE id = v_cualquier_lugar_id;
  END IF;
END $$;

-- 3. If a legacy 'home-outdoor' location row physically exists, decompose every reference to it
--    into home + outdoor, then remove the row entirely. No-op on a fresh DB (row never existed).
--
--    Two bugs found live on 2026-09-03: (a) this block used to copy the source row's is_primary
--    into BOTH split rows unconditionally, so a primary home-outdoor row (e.g. tai-chi) produced
--    TWO primary rows for the same exercise; (b) even after fixing that, it still inserted the
--    new 'home' row BEFORE deleting the old home-outdoor row — uq_exercise_location_primary is
--    checked immediately per statement, not deferred to end of transaction, so the still-present
--    old primary blocked the new one regardless. Now stages the source rows in a temp table,
--    deletes the old row FIRST, then inserts: 'home' keeps the original is_primary (upserted, in
--    case a 'home' row already independently existed), 'outdoor' always false — an exercise
--    can't be primary at two locations at once, and 'home' is the tie-break, matching step 4's
--    own hardcoded choice for tai-chi below.
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

    CREATE TEMP TABLE tmp_home_outdoor_split ON COMMIT DROP AS
      SELECT exercise_id, is_primary, source
      FROM havit.exercise_location_map
      WHERE location_id = v_home_outdoor_id;

    DELETE FROM havit.exercise_location_map WHERE location_id = v_home_outdoor_id;
    DELETE FROM havit.exercise_locations WHERE id = v_home_outdoor_id;

    INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary, source, mapping_reason)
    SELECT exercise_id, v_home_id, is_primary, source, 'split from legacy home-outdoor'
    FROM tmp_home_outdoor_split
    ON CONFLICT (exercise_id, location_id) DO UPDATE
      SET is_primary = havit.exercise_location_map.is_primary OR EXCLUDED.is_primary;

    INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary, source, mapping_reason)
    SELECT exercise_id, v_outdoor_id, false, source, 'split from legacy home-outdoor'
    FROM tmp_home_outdoor_split
    ON CONFLICT (exercise_id, location_id) DO NOTHING;
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
