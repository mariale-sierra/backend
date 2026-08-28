-- 2026-08-28-01-expand-exercise-catalog.sql
-- The exercise catalog was 13 rows deep, 8 tagged 'Strength', 5 untagged
-- entirely, and 0 in any of the other 5 categories (Cardio Intense, Cardio
-- Low, Flexibility, Mind-Body, Functional). Net effect: dominant_activity_category
-- (Activity Color System v2, see dominant-activity-category.util.ts) could only
-- ever resolve to Strength or null for every challenge in the app — not a bug
-- in that computation, a content gap in what it has to work with.
--
-- Three parts, all idempotent (safe to re-run):
--   1. Recategorize 'running' (seeded as Strength, but tracking_mode is
--      'interval' — clearly meant to be cardio) to Cardio Intense.
--   2. Tag the 5 exercises that were never tagged at all (deadlift,
--      lat-pulldown, barbell-row, tricep-pushdown, crunch) as Strength, with
--      the same primary location the catalog's other Strength exercises
--      already use (determined dynamically below, not hardcoded — this file
--      doesn't get to assume what that pattern is).
--   3. Seed 2 new exercises in each of the 5 empty categories, each with the
--      full chain (exercise row, primary category, primary location,
--      exercise_metrics) — not just a category tag — using the metric_types
--      that already match ACTIVITY_METRIC_CONFIG in frontend/types/metrics.ts:
--      strength->reps, cardio->duration+distanceKm, flexibility/mind-body->
--      duration only, functional->reps (no 'rounds' metric_type exists yet;
--      not inventing one here, out of scope for this seed).

-- ---------------------------------------------------------------------
-- 1. Recategorize 'running' to Cardio Intense
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_running_id INT;
  v_cardio_intense_id INT;
  v_updated INT;
BEGIN
  SELECT id INTO v_running_id FROM havit.exercises WHERE slug = 'running';
  SELECT id INTO v_cardio_intense_id FROM havit.exercise_categories WHERE code = 'cardio_intense';

  IF v_running_id IS NULL OR v_cardio_intense_id IS NULL THEN
    RETURN; -- nothing to do (exercise or category missing on this DB)
  END IF;

  UPDATE havit.exercise_category_map
  SET category_id = v_cardio_intense_id
  WHERE exercise_id = v_running_id AND is_primary = true;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 'running' had no primary category row at all yet — insert one instead
  -- of assuming the UPDATE above found something to change.
  IF v_updated = 0 THEN
    INSERT INTO havit.exercise_category_map (exercise_id, category_id, is_primary)
    VALUES (v_running_id, v_cardio_intense_id, true)
    ON CONFLICT (exercise_id, category_id) DO UPDATE SET is_primary = true;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Tag the 5 untagged exercises as Strength, matching the catalog's
--    existing Strength location pattern
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_strength_id INT;
  v_location_id INT;
BEGIN
  SELECT id INTO v_strength_id FROM havit.exercise_categories WHERE code = 'strength';

  -- Most common primary location among exercises already tagged Strength —
  -- "matching the other Strength rows' pattern" without this file guessing
  -- what that pattern is.
  SELECT elm.location_id INTO v_location_id
  FROM havit.exercise_location_map elm
  JOIN havit.exercise_category_map ecm
    ON ecm.exercise_id = elm.exercise_id AND ecm.is_primary = true
  WHERE elm.is_primary = true AND ecm.category_id = v_strength_id
  GROUP BY elm.location_id
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  IF v_location_id IS NULL THEN
    -- Fallback if no Strength exercise has a primary location yet on this DB.
    SELECT id INTO v_location_id FROM havit.exercise_locations WHERE code = 'gym';
  END IF;

  IF v_strength_id IS NULL OR v_location_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO havit.exercise_category_map (exercise_id, category_id, is_primary)
  SELECT e.id, v_strength_id, true
  FROM havit.exercises e
  WHERE e.slug IN ('deadlift', 'lat-pulldown', 'barbell-row', 'tricep-pushdown', 'crunch')
  ON CONFLICT (exercise_id, category_id) DO UPDATE SET is_primary = true;

  INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary)
  SELECT e.id, v_location_id, true
  FROM havit.exercises e
  WHERE e.slug IN ('deadlift', 'lat-pulldown', 'barbell-row', 'tricep-pushdown', 'crunch')
  ON CONFLICT (exercise_id, location_id) DO UPDATE SET is_primary = true;
END $$;

-- ---------------------------------------------------------------------
-- 3. Seed 2 new exercises per empty category (10 total), full chain
-- ---------------------------------------------------------------------
INSERT INTO havit.exercises (name, slug, description, instructions, tracking_mode, is_active) VALUES
  ('Sprint Intervals', 'sprint-intervals',
   'Short, near-maximal-effort running intervals with rest between reps — the highest-intensity cardio in the catalog.',
   'Warm up for 5 minutes. Sprint at ~90% effort for 20-30 seconds, then walk or jog to recover for 60-90 seconds. Repeat for the prescribed number of intervals. Cool down with easy walking.',
   'interval', true),
  ('Jump Rope HIIT', 'jump-rope-hiit',
   'Fast-paced jump rope work in short, high-effort bursts.',
   'Jump at a fast, sustainable pace for 30-45 seconds, then rest 15-20 seconds. Repeat for the prescribed number of rounds, keeping jumps low and quick.',
   'interval', true),

  ('Brisk Walk', 'brisk-walk',
   'Steady-state walking at a pace that noticeably raises your heart rate without becoming breathless.',
   'Walk at a pace where you can still hold a conversation but not sing. Maintain a consistent pace for the full duration. Good on flat or gently rolling terrain.',
   'single', true),
  ('Zone 2 Bike Ride', 'zone-2-bike-ride',
   'Easy, sustained cycling at a conversational pace — builds aerobic base without accumulating fatigue.',
   'Ride at a steady effort where breathing stays easy and controlled (roughly 60-70% of max heart rate). Keep cadence and effort consistent for the full duration rather than pushing hard sections.',
   'single', true),

  ('Standing Hamstring Stretch', 'standing-hamstring-stretch',
   'A static stretch targeting the back of the thigh, done standing with minimal setup.',
   'Extend one leg forward with the heel on the ground and toes up. Hinge at the hips and lean forward slightly, keeping your back straight, until you feel a gentle stretch behind the thigh. Hold, then switch sides.',
   'single', true),
  ('Hip Flexor Stretch', 'hip-flexor-stretch',
   'A static kneeling stretch that opens the front of the hip.',
   'Kneel on one knee with the other foot planted in front, both knees at roughly 90 degrees. Shift your weight forward gently until you feel a stretch across the front of the kneeling hip. Hold, then switch sides.',
   'single', true),

  ('Guided Breathwork', 'guided-breathwork',
   'A seated breathing practice for downregulating the nervous system between hard training days.',
   'Sit comfortably with a straight spine. Breathe in slowly through the nose for a count of 4, hold for 4, exhale slowly for a count of 6. Repeat for the prescribed duration, keeping the exhale longer than the inhale.',
   'single', true),
  ('Restorative Yoga Flow', 'restorative-yoga-flow',
   'A slow, low-intensity sequence of supported yoga poses focused on mobility and recovery, not strength.',
   'Move slowly through a sequence of gentle poses (e.g. child''s pose, cat-cow, seated forward fold), holding each for several breaths. Prioritize relaxed, controlled breathing over depth of stretch.',
   'single', true),

  ('Kettlebell Swing', 'kettlebell-swing',
   'A hip-hinge power movement using a kettlebell — a staple functional-training exercise.',
   'Stand with feet shoulder-width apart, kettlebell on the floor in front of you. Hinge at the hips to grip it, then drive through the hips to swing it to chest height, letting it swing back between your legs on the way down. Keep the back flat throughout.',
   'sets', true),
  ('Battle Ropes', 'battle-ropes',
   'High-effort alternating or double-arm rope waves for full-body conditioning.',
   'Hold one end of the rope in each hand, knees slightly bent, core braced. Alternate slamming the ropes up and down (or slam both together) for the prescribed number of reps or work period, keeping a steady rhythm.',
   'sets', true)
ON CONFLICT (slug) DO NOTHING;

-- Primary category per new exercise.
INSERT INTO havit.exercise_category_map (exercise_id, category_id, is_primary)
SELECT e.id, ec.id, true
FROM (VALUES
  ('sprint-intervals', 'cardio_intense'),
  ('jump-rope-hiit', 'cardio_intense'),
  ('brisk-walk', 'cardio_low'),
  ('zone-2-bike-ride', 'cardio_low'),
  ('standing-hamstring-stretch', 'flexibility'),
  ('hip-flexor-stretch', 'flexibility'),
  ('guided-breathwork', 'mind_body'),
  ('restorative-yoga-flow', 'mind_body'),
  ('kettlebell-swing', 'functional'),
  ('battle-ropes', 'functional')
) AS mapping(exercise_slug, category_code)
JOIN havit.exercises e ON e.slug = mapping.exercise_slug
JOIN havit.exercise_categories ec ON ec.code = mapping.category_code
ON CONFLICT (exercise_id, category_id) DO UPDATE SET is_primary = true;

-- Primary location per new exercise.
INSERT INTO havit.exercise_location_map (exercise_id, location_id, is_primary)
SELECT e.id, el.id, true
FROM (VALUES
  ('sprint-intervals', 'outdoor'),
  ('jump-rope-hiit', 'anywhere'),
  ('brisk-walk', 'outdoor'),
  ('zone-2-bike-ride', 'gym'),
  ('standing-hamstring-stretch', 'anywhere'),
  ('hip-flexor-stretch', 'anywhere'),
  ('guided-breathwork', 'anywhere'),
  ('restorative-yoga-flow', 'studio'),
  ('kettlebell-swing', 'gym'),
  ('battle-ropes', 'gym')
) AS mapping(exercise_slug, location_code)
JOIN havit.exercises e ON e.slug = mapping.exercise_slug
JOIN havit.exercise_locations el ON el.code = mapping.location_code
ON CONFLICT (exercise_id, location_id) DO UPDATE SET is_primary = true;

-- Metrics per new exercise, matching frontend/types/metrics.ts's
-- ACTIVITY_METRIC_CONFIG for each exercise's category: cardio ->
-- duration (primary, required) + distanceKm (secondary, optional);
-- flexibility/mind-body -> duration only (primary, required); functional ->
-- reps only (primary, required) — ACTIVITY_METRIC_CONFIG also lists 'rounds'
-- for functional, but no matching metric_type exists yet and this seed
-- doesn't invent one.
INSERT INTO havit.exercise_metrics (exercise_id, metric_type_id, is_required, is_primary, default_unit)
SELECT e.id, mt.id, mapping.is_required, mapping.is_primary, mt.default_unit
FROM (VALUES
  ('sprint-intervals', 'duration', true, true),
  ('sprint-intervals', 'distanceKm', false, false),
  ('jump-rope-hiit', 'duration', true, true),
  ('jump-rope-hiit', 'distanceKm', false, false),
  ('brisk-walk', 'duration', true, true),
  ('brisk-walk', 'distanceKm', false, false),
  ('zone-2-bike-ride', 'duration', true, true),
  ('zone-2-bike-ride', 'distanceKm', false, false),
  ('standing-hamstring-stretch', 'duration', true, true),
  ('hip-flexor-stretch', 'duration', true, true),
  ('guided-breathwork', 'duration', true, true),
  ('restorative-yoga-flow', 'duration', true, true),
  ('kettlebell-swing', 'reps', true, true),
  ('battle-ropes', 'reps', true, true)
) AS mapping(exercise_slug, metric_code, is_required, is_primary)
JOIN havit.exercises e ON e.slug = mapping.exercise_slug
JOIN havit.metric_types mt ON mt.code = mapping.metric_code
ON CONFLICT (exercise_id, metric_type_id) DO UPDATE
  SET is_required = EXCLUDED.is_required, is_primary = EXCLUDED.is_primary;
