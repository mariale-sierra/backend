-- 2026-07-30-01-seed-body-parts.sql
-- Seeds the body_parts catalog (0 rows before this) with a two-level muscle
-- group hierarchy, so the muscle-group picker in the routine-creation flow
-- (frontend/components/routine/exercise-picker/MuscleGroupPickerModal.tsx)
-- has real data to show instead of the hardcoded MUSCLE_GROUPS mock, and so
-- ensureExerciseBodyParts (backend/src/challenges/challenges.service.ts) has
-- rows to match muscle_groups names against.
--
-- Level 0 = broad region (Upper Body / Lower Body / Core), level 1 = the
-- specific groups the app surfaces to users today. Level-1 names match the
-- frontend's previous MUSCLE_GROUPS constant so no other adapter needs a
-- rename to pick these up.

INSERT INTO havit.body_parts (code, name, level, parent_id, sort_order, is_active) VALUES
  ('upper_body', 'Upper Body', 0, NULL, 1, true),
  ('lower_body', 'Lower Body', 0, NULL, 2, true),
  ('core_region', 'Core Region', 0, NULL, 3, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO havit.body_parts (code, name, level, parent_id, sort_order, is_active)
SELECT 'chest', 'Chest', 1, id, 1, true FROM havit.body_parts WHERE code = 'upper_body'
UNION ALL
SELECT 'back', 'Back', 1, id, 2, true FROM havit.body_parts WHERE code = 'upper_body'
UNION ALL
SELECT 'shoulders', 'Shoulders', 1, id, 3, true FROM havit.body_parts WHERE code = 'upper_body'
UNION ALL
SELECT 'arms', 'Arms', 1, id, 4, true FROM havit.body_parts WHERE code = 'upper_body'
UNION ALL
SELECT 'glutes', 'Glutes', 1, id, 1, true FROM havit.body_parts WHERE code = 'lower_body'
UNION ALL
SELECT 'legs', 'Legs', 1, id, 2, true FROM havit.body_parts WHERE code = 'lower_body'
UNION ALL
SELECT 'core', 'Core', 1, id, 1, true FROM havit.body_parts WHERE code = 'core_region'
UNION ALL
SELECT 'full_body', 'Full Body', 1, id, 2, true FROM havit.body_parts WHERE code = 'core_region'
ON CONFLICT (code) DO NOTHING;
