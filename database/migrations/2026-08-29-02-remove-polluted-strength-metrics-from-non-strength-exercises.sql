-- 2026-08-29-02-remove-polluted-strength-metrics-from-non-strength-exercises.sql
-- Data cleanup for the bug fixed in ChallengesService.resolveExercise()
-- (src/challenges/challenges.service.ts): it used to call
-- ensureExerciseMetrics() unconditionally, even when reusing an EXISTING
-- catalog exercise, silently registering 'reps'+'weight' as additional
-- allowed exercise_metrics on top of whatever that exercise was really
-- seeded with. Confirmed live via GET /exercises/:id/full: Brisk Walk
-- (Cardio Low) and Guided Breathwork (Mind-Body) both had 'reps'+'weight'
-- polluted onto their real metrics ('time'/'distance'), which is why the
-- frontend's Routine Builder started showing nonsensical reps/weight fields
-- for them. The code fix (same day) stops this going forward; this migration
-- removes the rows already polluted.
--
-- Scope: only 'reps'/'weight' rows on exercises whose PRIMARY category is
-- Cardio Intense / Cardio Low / Flexibility / Mind-Body — these categories
-- never legitimately track reps or weight (see the original catalog seed,
-- 2026-08-28-01-expand-exercise-catalog.sql's own comment: "functional ->
-- reps only", cardio/flexibility/mind-body get duration/distance only).
-- Strength and Functional are deliberately excluded — both legitimately use
-- 'reps' (Functional) or 'reps'+'weight' (Strength), so this must not touch
-- them even though they went through the same code path.
DELETE FROM havit.exercise_metrics em
USING havit.metric_types mt,
      havit.exercise_category_map ecm,
      havit.exercise_categories ec
WHERE em.metric_type_id = mt.id
  AND mt.code IN ('reps', 'weight')
  AND ecm.exercise_id = em.exercise_id
  AND ecm.category_id = ec.id
  AND ecm.is_primary = true
  AND ec.name IN ('Cardio Intense', 'Cardio Low', 'Flexibility', 'Mind-Body');

