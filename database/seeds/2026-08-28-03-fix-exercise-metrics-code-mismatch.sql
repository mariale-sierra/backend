-- 2026-08-28-03-fix-exercise-metrics-code-mismatch.sql
-- Same root cause and same fix shape as
-- 2026-08-28-02-fix-exercise-catalog-code-mismatches.sql, this time for
-- metric_types. 2026-08-28-01-expand-exercise-catalog.sql assumed the
-- 'duration'/'distanceKm' codes from
-- 2026-07-17-01-seed-exercise-categories-locations-metrics.sql — that seed
-- never actually ran either (same missing-db:migrate history), and this
-- DB's real metric_types catalog uses 'time' (seconds) and 'distance' (km)
-- for the same concepts instead. 'reps' happened to already match (verified
-- via GET /exercises/23/full showing Kettlebell Swing's reps metric present),
-- so only the 8 cardio/flexibility/mind-body exercises that wanted
-- duration/distance metrics are missing them — GET /exercises/15/full
-- (Sprint Intervals) confirmed an empty metrics: [] before this.
--
-- Idempotent: safe to re-run, no-op on a future fresh DB where 2026-08-28-01
-- finds the original 'duration'/'distanceKm' codes and this file's codes
-- ('time'/'distance') don't exist to match against.

INSERT INTO havit.exercise_metrics (exercise_id, metric_type_id, is_required, is_primary, default_unit)
SELECT e.id, mt.id, mapping.is_required, mapping.is_primary, mt.default_unit
FROM (VALUES
  ('sprint-intervals', 'time', true, true),
  ('sprint-intervals', 'distance', false, false),
  ('jump-rope-hiit', 'time', true, true),
  ('jump-rope-hiit', 'distance', false, false),
  ('brisk-walk', 'time', true, true),
  ('brisk-walk', 'distance', false, false),
  ('zone-2-bike-ride', 'time', true, true),
  ('zone-2-bike-ride', 'distance', false, false),
  ('standing-hamstring-stretch', 'time', true, true),
  ('hip-flexor-stretch', 'time', true, true),
  ('guided-breathwork', 'time', true, true),
  ('restorative-yoga-flow', 'time', true, true)
) AS mapping(exercise_slug, metric_code, is_required, is_primary)
JOIN havit.exercises e ON e.slug = mapping.exercise_slug
JOIN havit.metric_types mt ON mt.code = mapping.metric_code
ON CONFLICT (exercise_id, metric_type_id) DO UPDATE
  SET is_required = EXCLUDED.is_required, is_primary = EXCLUDED.is_primary;
