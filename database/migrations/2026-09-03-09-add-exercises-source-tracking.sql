-- 2026-09-03-09-add-exercises-source-tracking.sql
-- Traces every exercise back to where it came from, and makes the RepDB importer idempotent:
-- upsert key is (source, source_id). content_locked lets an admin hand-edit an imported
-- exercise's text without the importer overwriting it on the next run (relational data —
-- muscles/locations/categories/assets — still updates unless that specific relation is
-- manual_override). exercise_source_metadata is a narrow, deliberate exception to "avoid JSON":
-- it archives raw RepDB fields (category/mechanic/difficulty/met/tags/goals/equipment/
-- variation_group) that are NEVER read by app code at runtime — only so the location/category
-- inference rules can be re-run later without re-fetching RepDB.

ALTER TABLE havit.exercises
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_import_id BIGINT REFERENCES havit.dataset_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exercise_source_metadata JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_exercises_source_source_id
  ON havit.exercises(source, source_id) WHERE source_id IS NOT NULL;

COMMENT ON COLUMN havit.exercises.source IS 'manual (hand-seeded, legacy) | repdb (imported).';
COMMENT ON COLUMN havit.exercises.source_id IS 'RepDB''s own exercise id, e.g. "barbell-squat". Upsert key together with source.';
COMMENT ON COLUMN havit.exercises.content_locked IS 'true = importer skips text fields on re-run (admin hand-edited); relations still sync unless manual_override.';
COMMENT ON COLUMN havit.exercises.exercise_source_metadata IS 'Raw RepDB fields, archived only to re-derive inference rules later. Never read at app runtime.';
