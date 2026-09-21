-- 2026-09-21-04-fix-repdb-bodyweight-conditioning-category.sql
--
-- Real, confirmed data bug (reported live: "burpees shouldn't have
-- kilometers" — and, downstream of it, a "strength" challenge whose
-- exercises included some of these showing the wrong — cardio-intense —
-- accent color instead of strength's).
--
-- `src/exercises/lib/repdb-mapping.ts`'s `inferCategories()` puts every
-- RepDB `category: "cardio"` exercise with MET >= 7 into our `cardio-intense`
-- category, which the frontend's ACTIVITY_METRIC_CONFIG then tracks with
-- duration + DISTANCE (km) — correct for the machine/locomotion cardio
-- exercises RepDB also tags `cardio` (running, treadmill, rowing, stationary
-- bike, ...), wrong for a handful of bodyweight INTERVAL/conditioning drills
-- that RepDB happens to tag `cardio` too purely because of their MET, not
-- because they're distance-trackable: you don't log kilometers of burpees.
--
-- Verified by hand against the full vendored dataset
-- (database/importers/repdb/dataset/exercises.json, 601 exercises): exactly
-- 16 have RepDB category "cardio", of which exactly 4 are bodyweight,
-- non-locomotion, MET>=7 conditioning drills with no way to distinguish them
-- from real distance cardio (running/walking) via any dataset field —
-- tags/goals/mechanic are identical between them. Hand-picked by source_id
-- for that reason, not inferred by a general rule (repdb-mapping.ts's
-- `inferCategories` is fixed alongside this migration so a future re-import
-- classifies them the same way from the start):
--   burpees, high-knees, jumping-jacks, mountain-climbers
-- -> `functional` (rounds + reps — how these are actually programmed:
--    "3 rounds of 15 burpees"), not `cardio-intense`.
--
-- Only touches `source = 'inferred'` rows, the same guard the importer
-- itself already respects (never overwrites a `manual_override` an admin
-- set by hand via POST /exercises/:id/relations).

WITH targets AS (
  SELECT id
  FROM havit.exercises
  WHERE source = 'repdb'
    AND source_id IN ('burpees', 'high-knees', 'jumping-jacks', 'mountain-climbers')
),
functional_category AS (
  SELECT id FROM havit.exercise_categories WHERE code = 'functional'
)
DELETE FROM havit.exercise_category_map ecm
USING targets
WHERE ecm.exercise_id = targets.id
  AND ecm.source = 'inferred';

INSERT INTO havit.exercise_category_map (exercise_id, category_id, is_primary, source, mapping_reason)
SELECT targets.id, functional_category.id, true, 'inferred', 'bodyweight interval/conditioning drill, not distance-trackable (data fix 2026-09-21)'
FROM (
  SELECT id
  FROM havit.exercises
  WHERE source = 'repdb'
    AND source_id IN ('burpees', 'high-knees', 'jumping-jacks', 'mountain-climbers')
) AS targets
CROSS JOIN (
  SELECT id FROM havit.exercise_categories WHERE code = 'functional'
) AS functional_category
ON CONFLICT (exercise_id, category_id) DO UPDATE
  SET is_primary = true, source = 'inferred', mapping_reason = EXCLUDED.mapping_reason;
