-- 2025-02-19-02-primary-exercise-relations.sql
-- Ensures a single "primary" category/location per exercise via partial unique indexes.
-- Ported from the legacy TypeORM migration
-- backend/src/migrations/primary-exercise-relations.migration.ts (frozen, kept for history).
-- The is_primary columns already ship in database/init/2026-07-07-00-init-schema.sql;
-- the ADD COLUMN lines below are defensive no-ops on a DB created from that init file,
-- and real work for a DB baselined from an older snapshot without them.

ALTER TABLE havit.exercise_category_map
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE havit.exercise_location_map
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_category_primary
  ON havit.exercise_category_map (exercise_id) WHERE is_primary = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_exercise_location_primary
  ON havit.exercise_location_map (exercise_id) WHERE is_primary = true;
