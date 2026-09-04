-- 2026-09-03-04-create-muscle-svg-parts.sql
-- Anatomical SVG mapping for the muscle_mapper `minimal` style anatomy illustrations. Stores
-- ONLY anatomical meaning (which real <g id> in the SVG represents this muscle) — never visual
-- render state (selected/intensity/color), which is a frontend-only concern computed from
-- exercise_muscles.role at render time.
--
-- `is_fallback` distinguishes a real anatomical mapping (this svg_part_id genuinely belongs to
-- this muscle) from a borrowed visual approximation for one of the 7 muscles with no real
-- coverage in the minimal SVG (e.g. supraspinatus has no dedicated path, so its row here points
-- at a neighboring muscle's path with is_fallback=true — but muscle_id still correctly points at
-- supraspinatus everywhere else in the schema; the DB never confuses one muscle for another,
-- only borrows its drawing as an approximation).

CREATE TYPE havit.svg_view_enum AS ENUM ('front', 'back');
CREATE TYPE havit.svg_side_enum AS ENUM ('left', 'right', 'center');
CREATE TYPE havit.svg_coverage_enum AS ENUM ('exact', 'grouped', 'partial', 'unavailable');

CREATE TABLE IF NOT EXISTS havit.muscle_svg_parts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  muscle_id BIGINT NOT NULL,
  view havit.svg_view_enum NOT NULL,
  side havit.svg_side_enum NOT NULL DEFAULT 'center',
  svg_part_id VARCHAR(100) NOT NULL,
  coverage havit.svg_coverage_enum NOT NULL,
  is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  notes VARCHAR(300),
  source VARCHAR(30) NOT NULL DEFAULT 'muscle_mapper_minimal',
  CONSTRAINT fk_muscle_svg_parts_muscle
    FOREIGN KEY (muscle_id) REFERENCES havit.muscles(id) ON DELETE CASCADE,
  CONSTRAINT uq_muscle_svg_parts UNIQUE (muscle_id, view, side, svg_part_id)
);

CREATE INDEX IF NOT EXISTS idx_muscle_svg_parts_muscle ON havit.muscle_svg_parts(muscle_id);

COMMENT ON TABLE havit.muscle_svg_parts IS 'Muscle -> raw muscle_mapper minimal-SVG <g id> mapping. One muscle can map to several parts.';
COMMENT ON COLUMN havit.muscle_svg_parts.is_fallback IS 'true = this svg_part_id belongs to a DIFFERENT muscle, borrowed as a visual approximation (coverage=unavailable only). false = the real anatomical mapping.';
