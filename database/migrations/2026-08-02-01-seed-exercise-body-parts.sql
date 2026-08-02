-- 2026-08-02-01-seed-exercise-body-parts.sql
-- Tags the current exercise catalog with real body parts, so the "browse by
-- muscle" picker in the routine-creation flow (frontend
-- MuscleGroupPickerModal, fed by GET /exercises which now returns
-- muscle_groups per exercise) has curated data to filter on instead of
-- prompting a possibly-new user to guess which muscle an exercise works.
-- exercise_body_part_map existed with 0 rows before this — nothing had ever
-- written to it (the "ask on add" flow this replaces never shipped tags
-- either).

INSERT INTO havit.exercise_body_part_map (exercise_id, body_part_id, relation_type, priority_order)
SELECT e.id, bp.id, 'primary', 1
FROM (VALUES
  ('running', 'legs'),
  ('bench-press', 'chest'),
  ('squat', 'legs'),
  ('deadlift', 'back'),
  ('shoulder-press', 'shoulders'),
  ('lat-pulldown', 'back'),
  ('barbell-row', 'back'),
  ('leg-press', 'legs'),
  ('bicep-curl', 'arms'),
  ('tricep-pushdown', 'arms'),
  ('crunch', 'core')
) AS mapping(exercise_slug, body_part_code)
JOIN havit.exercises e ON e.slug = mapping.exercise_slug
JOIN havit.body_parts bp ON bp.code = mapping.body_part_code
ON CONFLICT (exercise_id, body_part_id) DO NOTHING;

-- Deadlift also works the legs (secondary).
INSERT INTO havit.exercise_body_part_map (exercise_id, body_part_id, relation_type, priority_order)
SELECT e.id, bp.id, 'secondary', 2
FROM havit.exercises e
JOIN havit.body_parts bp ON bp.code = 'legs'
WHERE e.slug = 'deadlift'
ON CONFLICT (exercise_id, body_part_id) DO NOTHING;
