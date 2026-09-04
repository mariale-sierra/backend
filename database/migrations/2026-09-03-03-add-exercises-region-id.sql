-- 2026-09-03-03-add-exercises-region-id.sql
-- A single FK, not a map table: RepDB models `body_part` as one scalar field per exercise,
-- so an exercise has exactly one primary anatomical region.

ALTER TABLE havit.exercises
  ADD COLUMN IF NOT EXISTS region_id BIGINT REFERENCES havit.muscle_regions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_exercises_region_id ON havit.exercises(region_id);

COMMENT ON COLUMN havit.exercises.region_id IS 'Primary anatomical region (RepDB body_part). Nullable for legacy hand-seeded exercises.';
