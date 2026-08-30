-- 2026-08-29-04-fix-crunch-missing-metrics-and-running-stray-pace.sql
-- Two real data bugs found via a full-catalog audit of GET /exercises/:id/full
-- (frontend user report: "we should check all exercises because there is
-- probably other bugs over there"), neither caused by the resolveExercise()
-- pollution bug already fixed (2026-08-29, commit before this one) — both
-- predate it, from the original catalog rows (exercises.id 1-12).
--
-- 1. "Crunch" (slug 'crunch') has ZERO rows in exercise_metrics at all —
--    every other Strength exercise in the catalog (Bench Press, Squat,
--    Deadlift, Shoulder Press, Lat Pulldown, Barbell Row, Leg Press, Bicep
--    Curl, Tricep Pushdown) has reps+weight; Crunch alone has nothing to log
--    against. Backfilled to match its siblings exactly (is_primary on 'reps',
--    same as ChallengesService.ensureExerciseMetrics's own convention for a
--    brand-new exercise).
INSERT INTO havit.exercise_metrics (exercise_id, metric_type_id, is_required, is_primary, default_unit)
SELECT e.id, mt.id, false, (mt.code = 'reps'), mt.default_unit
FROM havit.exercises e
JOIN havit.metric_types mt ON mt.code IN ('reps', 'weight')
WHERE e.slug = 'crunch'
ON CONFLICT (exercise_id, metric_type_id) DO NOTHING;

-- 2. "Running" (slug 'running', exercises.id 1 — the oldest row in the
--    catalog, predating the 2026-07-17 seed that standardized every other
--    cardio exercise on time+distance) also has a third metric, 'pace'
--    (metric_types.code='pace', id 7) — a leftover from an older, larger,
--    partly-Spanish metric_types scheme (weight_kg/weight_lb/duration_seconds/
--    distance_km/pace_min_km/etc., ids 9-22) that the rest of the app was
--    never built against (frontend's WorkoutMetricCode type only knows
--    'reps'/'weight'/'time'/'distance' — a 'pace' field would render in the
--    Routine Builder but nothing downstream, e.g. Log-Metrics, understands
--    that code). Removed so Running matches every other Cardio exercise
--    (Sprint Intervals, Jump Rope HIIT, Brisk Walk, Zone 2 Bike Ride) with
--    just time+distance. The other 13 unused legacy metric_types rows are
--    left alone — out of scope here, flagged separately, not touched by any
--    real exercise so not urgent.
DELETE FROM havit.exercise_metrics em
USING havit.exercises e, havit.metric_types mt
WHERE em.exercise_id = e.id
  AND em.metric_type_id = mt.id
  AND e.slug = 'running'
  AND mt.code = 'pace';

