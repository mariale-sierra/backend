-- 2026-09-03-05-extend-exercise-location-category-map-source.sql
-- Extends the EXISTING exercise_location_map/exercise_category_map tables (rather than forking
-- parallel ones) so the RepDB importer's inferred tags and hand-made tags share one relation,
-- one set of constraints (including the existing "one primary" partial unique indexes), and one
-- code path in challenges.service.ts. Existing rows default to 'manual_override' — accurate,
-- since a human wrote them. Rows the importer inserts use 'inferred'.

CREATE TYPE havit.mapping_source_enum AS ENUM ('inferred', 'manual_override');

ALTER TABLE havit.exercise_location_map
  ADD COLUMN IF NOT EXISTS source havit.mapping_source_enum NOT NULL DEFAULT 'manual_override',
  ADD COLUMN IF NOT EXISTS mapping_reason VARCHAR(200);

ALTER TABLE havit.exercise_category_map
  ADD COLUMN IF NOT EXISTS source havit.mapping_source_enum NOT NULL DEFAULT 'manual_override',
  ADD COLUMN IF NOT EXISTS mapping_reason VARCHAR(200);

COMMENT ON COLUMN havit.exercise_location_map.source IS 'inferred = written by the RepDB importer from equipment/tags rules; manual_override = never touched by re-imports.';
COMMENT ON COLUMN havit.exercise_category_map.source IS 'inferred = written by the RepDB importer from category/force_type/mechanic/met rules; manual_override = never touched by re-imports.';
