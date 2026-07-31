-- 2026-07-17-01-seed-exercise-categories-locations-metrics.sql
-- Seeds the exercise_categories / exercise_locations catalogs with the values the
-- challenge-creation flow already uses on the frontend (frontend/app/challenge/create.tsx
-- CATEGORY_OPTIONS / LOCATION_OPTIONS), and seeds metric_types with the codes the
-- metrics screen already submits (frontend/hooks/useMetricsScreen.ts: 'reps'/'weight')
-- plus the schema-based cardio fields (frontend/store/routineBuilderStore.ts:
-- 'distanceKm'/'duration'). All three tables existed with zero rows before this —
-- the challenge-creation pipeline needs real rows to link against instead of dropping
-- categories/locations/metrics on the floor.

-- exercise_categories/exercise_locations carry a NOT NULL UNIQUE `code` in the
-- init schema, so we seed (code, name) and conflict on `code`. The app looks
-- these up by `name` (challenges.service), so the human-readable names are what
-- matter downstream; the codes are just the catalog's stable keys.
INSERT INTO havit.exercise_categories (code, name) VALUES
  ('strength', 'Strength'),
  ('cardio_intense', 'Cardio Intense'),
  ('cardio_low', 'Cardio Low'),
  ('flexibility', 'Flexibility'),
  ('mind_body', 'Mind-Body'),
  ('functional', 'Functional')
ON CONFLICT (code) DO NOTHING;

INSERT INTO havit.exercise_locations (code, name) VALUES
  ('gym', 'Gym'),
  ('home', 'Home'),
  ('outdoor', 'Outdoor'),
  ('studio', 'Studio'),
  ('anywhere', 'Anywhere')
ON CONFLICT (code) DO NOTHING;

INSERT INTO havit.metric_types (code, name, value_type, default_unit, description) VALUES
  ('reps', 'Repetitions', 'int', NULL, 'Number of repetitions performed in a set'),
  ('weight', 'Weight', 'decimal', 'lbs', 'Weight lifted for a set'),
  ('distanceKm', 'Distance', 'decimal', 'km', 'Distance covered during the exercise'),
  ('duration', 'Duration', 'seconds', NULL, 'Duration of the exercise or set')
ON CONFLICT (code) DO NOTHING;
