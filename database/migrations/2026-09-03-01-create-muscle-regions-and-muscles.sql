-- 2026-09-03-01-create-muscle-regions-and-muscles.sql
-- Curated muscle taxonomy for the RepDB exercise-catalog import, separate from the existing
-- generic `body_parts` recursive hierarchy (which stays untouched/unused by this new code —
-- see the technical plan for why: body_parts is a general-purpose tag hierarchy already used
-- by challenges.service.ts, mixing in a precise 29-muscle anatomical taxonomy with SVG-mapping
-- needs risks breaking its existing semantics).
--
-- Two levels: muscle_regions (9, matches RepDB's own `body_part` vocabulary exactly) and
-- muscles (29, matches RepDB's primary_muscles/secondary_muscles vocabulary). Curated, not
-- user-extensible — unlike exercise_categories/exercise_locations, which challenges.service.ts
-- auto-creates from free text, nothing here is ever auto-created by app code.

CREATE TABLE IF NOT EXISTS havit.muscle_regions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE havit.muscle_regions IS 'Curated top-level anatomical regions (9), matches RepDB body_part vocabulary.';

CREATE TABLE IF NOT EXISTS havit.muscles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  region_id BIGINT NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  icon_storage_key VARCHAR(300),
  icon_content_hash VARCHAR(64),
  CONSTRAINT fk_muscles_region
    FOREIGN KEY (region_id) REFERENCES havit.muscle_regions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_muscles_region_id ON havit.muscles(region_id);

COMMENT ON TABLE havit.muscles IS 'Curated individual muscles (29), matches RepDB primary/secondary_muscles vocabulary.';
COMMENT ON COLUMN havit.muscles.icon_storage_key IS 'R2 object key for the RepDB muscle icon (muscles/<code>.webp), nullable — 2 of 29 muscles have no RepDB icon.';
